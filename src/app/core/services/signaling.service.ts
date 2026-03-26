import { Injectable } from '@angular/core';
import { environment } from '@environments/environment';
import { SupabaseService } from './supabase.service';
import { CryptoService } from './crypto.service';
import { AdService } from './ad.service';
import { HasherService } from './transfer/hasher.service';
import { ChunkedStreamService } from './chunked-stream.service';
import { BurnSessionInfo } from './chunked-stream.types';
import { ReplaySubject, Subject } from 'rxjs';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConnectionStatus =
    | 'waiting'
    | 'connecting'
    | 'connected'
    | 'transferring'
    | 'completed'
    | 'error';

export interface FileShareSession {
    linkId: string;
    fileInfo: {
        name: string;
        size: number;
        hash: string;
        mimeType?: string;
    };
    mode: 'burn' | 'seed';
    passwordProtected: boolean;
    status: ConnectionStatus;
    createdAt: Date;
    transferType: 'burn' | 'cloud';
    r2Token: string | null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class SignalingService {

    private activeSessions = new Map<string, FileShareSession>();
    private sessionUpdates$ = new ReplaySubject<FileShareSession>(10);
    private signalingErrors$ = new Subject<{ linkId: string; error: string }>();

    /** Expose stream progress for UI binding */
    readonly senderProgress = this.stream.senderProgress;
    readonly receiverProgress = this.stream.receiverProgress;

    constructor(
        private supabase: SupabaseService,
        private crypto: CryptoService,
        private adService: AdService,
        private hasher: HasherService,
        private stream: ChunkedStreamService,
    ) {}

    // ═══════════════════════════════════════════════════════
    // SENDER
    // ═══════════════════════════════════════════════════════

    async startSenderSession(
        file: File,
        mode: 'burn' | 'seed',
        _password?: string,
        onHashProgress?: (progress: number) => void,
        customSlug?: string,
        dbExtras?: { transfer_type?: string; retention_policy?: string; r2_token?: string | null; expires_at?: string },
    ): Promise<{ linkId: string; session: FileShareSession }> {
        try {
            if (mode === 'seed' && !this.supabase.isAuthenticated()) {
                throw new Error('La condivisione persistente è disponibile solo per utenti registrati.');
            }

            const linkId = this.crypto.generateLinkId(12);
            const transferType = (dbExtras?.transfer_type === 'cloud' ? 'cloud' : 'burn') as 'burn' | 'cloud';
            const fileHash = await this.hasher.calculateHash(file, onHashProgress);

            const session: FileShareSession = {
                linkId,
                fileInfo: { name: file.name, size: file.size, hash: fileHash, mimeType: file.type },
                mode,
                passwordProtected: false,  // password encryption removed with WebRTC
                status: 'waiting',
                createdAt: new Date(),
                transferType,
                r2Token: null,
            };
            this.activeSessions.set(linkId, session);

            if (transferType === 'burn') {
                await this.setupBurnSender(file, fileHash, mode, linkId, session, customSlug, dbExtras);
            } else {
                await this.setupCloudSender(file, fileHash, mode, linkId, session, customSlug, dbExtras);
            }

            return { linkId, session };
        } catch (error: any) {
            throw new Error(`Failed to start sender session: ${error.message}`);
        }
    }

    private async setupBurnSender(
        file: File,
        fileHash: string,
        mode: 'burn' | 'seed',
        linkId: string,
        session: FileShareSession,
        customSlug?: string,
        dbExtras?: Record<string, any>,
    ): Promise<void> {
        const totalChunks = Math.ceil(file.size / (5 * 1024 * 1024));

        // Create R2 session token
        const token = await this.createR2BurnToken(file, fileHash, totalChunks);
        session.r2Token = token;

        // Persist in DB
        const userId = this.supabase.currentUser()?.id || null;
        const transferData: any = {
            sender_id: userId,
            file_name: file.name,
            file_size: file.size,
            file_hash: fileHash,
            mode: mode,
            link_id: linkId,
            password_protected: false,
            transfer_type: 'burn',
            retention_policy: 'burn',
            r2_token: token,
            ...dbExtras,
        };
        if (customSlug) transferData.custom_slug = customSlug;

        try {
            await this.supabase.createFileTransfer(transferData);
        } catch (e: any) {
            if (customSlug && e?.message?.includes('custom_slug')) {
                delete transferData.custom_slug;
                await this.supabase.createFileTransfer(transferData);
            } else throw e;
        }

        if (!this.supabase.isPremium()) {
            await this.supabase.incrementDailyFileCount();
        }

        // Subscribe to signaling: wait for receiver-ready, then handle chunk-ack
        await this.supabase.subscribeToSignaling(linkId, async (payload) => {
            const msg = payload.payload;
            if (!msg || msg.from !== 'receiver') return;

            if (msg.type === 'receiver-ready' && session.status === 'waiting') {
                // Receiver has opened the page → start uploading
                this.updateSessionStatus(linkId, 'transferring');
                this.runBurnUpload(file, fileHash, token, linkId, session);
            } else if (msg.type === 'chunk-ack') {
                this.stream.notifyChunkAck(msg.chunkIndex);
            }
        });

        // Emit session so UI can show the shareable link
        this.sessionUpdates$.next(session);
    }

    private runBurnUpload(
        file: File,
        fileHash: string,
        token: string,
        linkId: string,
        session: FileShareSession,
    ): void {
        const interval = setInterval(() => {
            const state = this.stream.senderState();
            if (state === 'completed') {
                clearInterval(interval);
                this.updateSessionStatus(linkId, 'completed');
                this.postTransferCleanup(linkId, session);
            } else if (state === 'error') {
                clearInterval(interval);
                this.updateSessionStatus(linkId, 'error');
                this.signalingErrors$.next({ linkId, error: this.stream.errorMessage() });
            }
        }, 100);

        this.stream.startBurnUpload(file, linkId, token, fileHash).catch(err => {
            clearInterval(interval);
            this.updateSessionStatus(linkId, 'error');
            this.signalingErrors$.next({ linkId, error: err.message });
        });
    }

    private async setupCloudSender(
        file: File,
        fileHash: string,
        mode: 'burn' | 'seed',
        linkId: string,
        session: FileShareSession,
        customSlug?: string,
        dbExtras?: Record<string, any>,
    ): Promise<void> {
        // Cloud: the upload component drives the R2TransferService directly.
        // SignalingService only creates the DB record and emits the session.
        const userId = this.supabase.currentUser()?.id || null;
        const transferData: any = {
            sender_id: userId,
            file_name: file.name,
            file_size: file.size,
            file_hash: fileHash,
            mode: mode,
            link_id: linkId,
            password_protected: false,
            transfer_type: 'cloud',
            ...dbExtras,
        };
        if (customSlug) transferData.custom_slug = customSlug;

        try {
            await this.supabase.createFileTransfer(transferData);
        } catch (e: any) {
            if (customSlug && e?.message?.includes('custom_slug')) {
                delete transferData.custom_slug;
                await this.supabase.createFileTransfer(transferData);
            } else throw e;
        }

        if (!this.supabase.isPremium()) {
            await this.supabase.incrementDailyFileCount();
        }

        this.sessionUpdates$.next(session);
    }

    // ═══════════════════════════════════════════════════════
    // RECEIVER
    // ═══════════════════════════════════════════════════════

    async joinReceiverSession(linkId: string): Promise<FileShareSession> {
        try {
            const transfer = await this.supabase.getFileTransfer(linkId);
            if (!transfer) throw new Error('File transfer not found');
            if (transfer.status !== 'active') throw new Error(`Transfer is ${transfer.status}`);

            const transferType = (transfer.transfer_type === 'cloud' ? 'cloud' : 'burn') as 'burn' | 'cloud';

            const session: FileShareSession = {
                linkId,
                fileInfo: {
                    name: transfer.file_name,
                    size: transfer.file_size,
                    hash: transfer.file_hash,
                },
                mode: transfer.mode,
                passwordProtected: transfer.password_protected,
                status: 'waiting',
                createdAt: new Date(transfer.created_at),
                transferType,
                r2Token: transfer.r2_token ?? null,
            };
            this.activeSessions.set(linkId, session);

            if (transferType === 'cloud') {
                // Signal component to start R2 download directly
                session.status = 'connected';
                this.sessionUpdates$.next(session);
                return session;
            }

            // Burn streaming
            await this.setupBurnReceiver(linkId, session, transfer.r2_token!);
            return session;
        } catch (error: any) {
            throw new Error(`Failed to join receiver session: ${error.message}`);
        }
    }

    private async setupBurnReceiver(
        linkId: string,
        session: FileShareSession,
        token: string,
    ): Promise<void> {
        const { file_name, file_size, file_hash } = session.fileInfo
            ? { file_name: session.fileInfo.name, file_size: session.fileInfo.size, file_hash: session.fileInfo.hash }
            : await this.supabase.getFileTransfer(linkId).then(t => ({
                file_name: t.file_name,
                file_size: t.file_size,
                file_hash: t.file_hash,
            }));

        // Fetch totalChunks from R2 status
        const totalChunks = await this.fetchTotalChunks(token, file_size);

        const sessionInfo: BurnSessionInfo = {
            token,
            totalChunks,
            fileHash: file_hash,
            fileName: file_name,
            fileSize: file_size,
            contentType: 'application/octet-stream',
        };

        // Initialize receiver
        this.stream.startBurnReceive(sessionInfo, linkId, (blob, name) => {
            this.onBurnReceiveComplete(blob, name, linkId, session);
        });

        // Subscribe to sender signals
        await this.supabase.subscribeToSignaling(linkId, (payload) => {
            const msg = payload.payload;
            if (!msg || msg.from !== 'sender') return;

            if (msg.type === 'chunk-ready') {
                this.stream.notifyChunkReady(msg.chunkIndex);
                if (session.status !== 'transferring') {
                    this.updateSessionStatus(linkId, 'transferring');
                }
            } else if (msg.type === 'burn-complete') {
                this.stream.notifyBurnComplete(msg.fileHash, msg.totalChunks);
            }
        });

        // Notify sender: receiver is ready
        await this.supabase.sendSignal(linkId, {
            type: 'receiver-ready',
            from: 'receiver',
            timestamp: Date.now(),
        });

        this.updateSessionStatus(linkId, 'connecting');
    }

    private async onBurnReceiveComplete(
        blob: Blob,
        fileName: string,
        linkId: string,
        session: FileShareSession,
    ): Promise<void> {
        triggerBrowserDownload(blob, fileName);
        this.updateSessionStatus(linkId, 'completed');

        await this.supabase.incrementDownloadCount(linkId).catch(() => {});
        await this.adService.onTransferComplete().catch(() => {});

        if (session.mode === 'burn') {
            await this.supabase.updateTransferStatus(linkId, 'completed').catch(() => {});
        }

        this.stream.resetReceiver();
    }

    // ═══════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════

    private async createR2BurnToken(file: File, fileHash: string, totalChunks: number): Promise<string> {
        const res = await fetch(`${environment.r2.workerUrl}/transfer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Bam-Api-Key': environment.r2.apiKey,
            },
            body: JSON.stringify({
                fileName: file.name,
                fileSize: file.size,
                fileHash,
                contentType: file.type || 'application/octet-stream',
                retentionPolicy: 'burn',
                totalChunks,
            }),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Create burn token failed (${res.status}): ${body}`);
        }
        const data: any = await res.json();
        return data.token;
    }

    private async fetchTotalChunks(token: string, fileSize: number): Promise<number> {
        try {
            const res = await fetch(`${environment.r2.workerUrl}/transfer/${token}/status`);
            if (res.ok) {
                const data: any = await res.json();
                if (data.totalChunks) return data.totalChunks;
            }
        } catch (_) {}
        // Fallback: compute from file size
        return Math.ceil(fileSize / (5 * 1024 * 1024));
    }

    private async postTransferCleanup(linkId: string, session: FileShareSession): Promise<void> {
        if (this.supabase.isAuthenticated()) {
            await this.supabase.addXP(10).catch(() => {});
        }
        await this.adService.onTransferComplete().catch(() => {});
        await this.supabase.updateTransferStatus(linkId, 'completed').catch(() => {});
    }

    private updateSessionStatus(linkId: string, status: ConnectionStatus): void {
        const session = this.activeSessions.get(linkId);
        if (session) {
            session.status = status;
            this.sessionUpdates$.next(session);
        }
    }

    closeSession(linkId: string): void {
        this.stream.cancelUpload();
        this.stream.resetReceiver();
        this.supabase.removeSignalingChannel(linkId).catch(() => {});
        this.activeSessions.delete(linkId);
    }

    terminateWorkers(): void {
        this.hasher.terminateWorker();
    }

    getSession(linkId: string): FileShareSession | undefined {
        return this.activeSessions.get(linkId);
    }

    getSessionUpdates$() {
        return this.sessionUpdates$.asObservable();
    }

    getSignalingErrors$() {
        return this.signalingErrors$.asObservable();
    }

    cleanup(): void {
        this.activeSessions.forEach((_, linkId) => this.closeSession(linkId));
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function triggerBrowserDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
