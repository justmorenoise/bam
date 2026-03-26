import { Injectable, signal } from '@angular/core';
import { environment } from '@environments/environment';
import { SupabaseService } from './supabase.service';
import { HasherService } from './transfer/hasher.service';
import { BurnProgress, BurnSessionInfo, BurnState } from './chunked-stream.types';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_PARALLEL = 3;              // max chunks in flight simultaneously

// ─── Semaphore ───────────────────────────────────────────────────────────────

class Semaphore {
    private queue: (() => void)[] = [];

    constructor(private slots: number) {}

    acquire(): Promise<void> {
        if (this.slots > 0) {
            this.slots--;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => this.queue.push(resolve));
    }

    release(): void {
        const next = this.queue.shift();
        if (next) {
            next();
        } else {
            this.slots++;
        }
    }
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ChunkedStreamService {

    readonly senderState = signal<BurnState>('idle');
    readonly senderProgress = signal<BurnProgress | null>(null);
    readonly receiverState = signal<BurnState>('idle');
    readonly receiverProgress = signal<BurnProgress | null>(null);
    readonly errorMessage = signal('');

    private readonly baseUrl = environment.r2.workerUrl;

    // ─── Sender state ────────────────────────────────────────────
    private cancelled = false;
    private ackResolvers = new Map<number, () => void>();

    // ─── Receiver state ──────────────────────────────────────────
    private receivedChunks = new Map<number, ArrayBuffer>();
    private downloadQueue: number[] = [];
    private activeDownloads = 0;
    private expectedTotalChunks: number | null = null;
    private expectedFileHash: string | null = null;
    private onCompleteCallback: ((blob: Blob, name: string) => void) | null = null;
    private sessionInfo: BurnSessionInfo | null = null;
    private receiverLinkId: string | null = null;
    private receiverStartTime = 0;

    constructor(
        private supabase: SupabaseService,
        private hasher: HasherService,
    ) {}

    // ─── Sender API ──────────────────────────────────────────────

    async startBurnUpload(
        file: File,
        linkId: string,
        token: string,
        fileHash: string,
    ): Promise<void> {
        this.cancelled = false;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const startTime = Date.now();
        let chunksTransferred = 0;

        this.senderState.set('uploading');
        this.senderProgress.set({
            chunksTransferred: 0,
            totalChunks,
            bytesTransferred: 0,
            totalBytes: file.size,
            percentage: 0,
            speedBps: 0,
        });

        const sem = new Semaphore(MAX_PARALLEL);
        const indices = Array.from({ length: totalChunks }, (_, i) => i);

        await Promise.all(indices.map(async (i) => {
            await sem.acquire();
            if (this.cancelled) { sem.release(); return; }

            try {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const chunk = file.slice(start, end);

                await this.putChunk(token, i, chunk);
                if (this.cancelled) return;

                await this.supabase.sendSignal(linkId, {
                    type: 'chunk-ready',
                    from: 'sender',
                    chunkIndex: i,
                    totalChunks,
                    timestamp: Date.now(),
                });

                await this.waitForAck(i);
                if (this.cancelled) return;

                // Delete chunk after receiver ack (fire-and-forget, best-effort)
                this.deleteChunk(token, i).catch(err =>
                    console.warn(`[BURN] Delete chunk ${i} failed:`, err)
                );

                chunksTransferred++;
                const elapsed = (Date.now() - startTime) / 1000;
                const bytesTransferred = Math.min(chunksTransferred * CHUNK_SIZE, file.size);
                this.senderProgress.set({
                    chunksTransferred,
                    totalChunks,
                    bytesTransferred,
                    totalBytes: file.size,
                    percentage: Math.round((chunksTransferred / totalChunks) * 100),
                    speedBps: elapsed > 0 ? bytesTransferred / elapsed : 0,
                });
            } finally {
                sem.release();
            }
        }));

        if (this.cancelled) return;

        this.senderState.set('completed');
        await this.supabase.sendSignal(linkId, {
            type: 'burn-complete',
            from: 'sender',
            fileHash,
            totalChunks,
            timestamp: Date.now(),
        });
    }

    cancelUpload(): void {
        this.cancelled = true;
        // Unblock all pending ack waiters so the upload loop can exit
        this.ackResolvers.forEach(resolve => resolve());
        this.ackResolvers.clear();
        this.senderState.set('idle');
        this.senderProgress.set(null);
    }

    /** Called by SignalingService when a chunk-ack signal is received. */
    notifyChunkAck(chunkIndex: number): void {
        const resolve = this.ackResolvers.get(chunkIndex);
        if (resolve) {
            this.ackResolvers.delete(chunkIndex);
            resolve();
        }
    }

    // ─── Receiver API ────────────────────────────────────────────

    startBurnReceive(
        sessionInfo: BurnSessionInfo,
        linkId: string,
        onComplete: (blob: Blob, name: string) => void,
    ): void {
        this.sessionInfo = sessionInfo;
        this.receiverLinkId = linkId;
        this.onCompleteCallback = onComplete;
        this.receivedChunks.clear();
        this.downloadQueue = [];
        this.activeDownloads = 0;
        this.expectedTotalChunks = null;
        this.expectedFileHash = null;
        this.receiverStartTime = Date.now();
        this.errorMessage.set('');

        this.receiverState.set('downloading');
        this.receiverProgress.set({
            chunksTransferred: 0,
            totalChunks: sessionInfo.totalChunks,
            bytesTransferred: 0,
            totalBytes: sessionInfo.fileSize,
            percentage: 0,
            speedBps: 0,
        });
    }

    /** Called by SignalingService when a chunk-ready signal is received. */
    notifyChunkReady(chunkIndex: number): void {
        this.downloadQueue.push(chunkIndex);
        this.drainDownloadQueue();
    }

    /** Called by SignalingService when a burn-complete signal is received. */
    notifyBurnComplete(fileHash: string, totalChunks: number): void {
        this.expectedFileHash = fileHash;
        this.expectedTotalChunks = totalChunks;
        this.checkAssemblyReady();
    }

    resetReceiver(): void {
        this.receivedChunks.clear();
        this.downloadQueue = [];
        this.activeDownloads = 0;
        this.expectedTotalChunks = null;
        this.expectedFileHash = null;
        this.sessionInfo = null;
        this.receiverLinkId = null;
        this.onCompleteCallback = null;
        this.receiverState.set('idle');
        this.receiverProgress.set(null);
    }

    // ─── Sender internals ────────────────────────────────────────

    private async putChunk(token: string, index: number, chunk: Blob): Promise<void> {
        const res = await fetch(`${this.baseUrl}/transfer/${token}/chunks/${index}`, {
            method: 'PUT',
            headers: this.authHeaders(),
            body: chunk,
        });
        if (!res.ok) throw new Error(`[BURN] PUT chunk ${index} failed (${res.status})`);
    }

    private deleteChunk(token: string, index: number): Promise<void> {
        return fetch(`${this.baseUrl}/transfer/${token}/chunks/${index}`, {
            method: 'DELETE',
            headers: this.authHeaders(),
        }).then(res => {
            if (!res.ok && res.status !== 404) {
                throw new Error(`[BURN] DELETE chunk ${index} failed (${res.status})`);
            }
        });
    }

    private waitForAck(chunkIndex: number): Promise<void> {
        return new Promise<void>(resolve => {
            this.ackResolvers.set(chunkIndex, resolve);
        });
    }

    // ─── Receiver internals ──────────────────────────────────────

    private drainDownloadQueue(): void {
        while (this.activeDownloads < MAX_PARALLEL && this.downloadQueue.length > 0) {
            const index = this.downloadQueue.shift()!;
            this.activeDownloads++;
            this.downloadAndStore(index).finally(() => {
                this.activeDownloads--;
                this.drainDownloadQueue();
            });
        }
    }

    private async downloadAndStore(chunkIndex: number): Promise<void> {
        const { token } = this.sessionInfo!;

        try {
            const res = await fetch(`${this.baseUrl}/transfer/${token}/chunks/${chunkIndex}`);
            if (!res.ok) throw new Error(`[BURN] GET chunk ${chunkIndex} failed (${res.status})`);

            const buffer = await res.arrayBuffer();
            this.receivedChunks.set(chunkIndex, buffer);

            // Ack to sender so it can delete the chunk from R2
            await this.supabase.sendSignal(this.receiverLinkId!, {
                type: 'chunk-ack',
                from: 'receiver',
                chunkIndex,
                timestamp: Date.now(),
            });

            this.updateReceiverProgress();
            this.checkAssemblyReady();
        } catch (err) {
            console.error(`[BURN] Download chunk ${chunkIndex} failed:`, err);
            this.receiverState.set('error');
            this.errorMessage.set(`Errore nel download del chunk ${chunkIndex}. Riprova.`);
        }
    }

    private updateReceiverProgress(): void {
        const { fileSize, totalChunks } = this.sessionInfo!;
        const bytesTransferred = [...this.receivedChunks.values()]
            .reduce((sum, buf) => sum + buf.byteLength, 0);
        const elapsed = (Date.now() - this.receiverStartTime) / 1000;

        this.receiverProgress.set({
            chunksTransferred: this.receivedChunks.size,
            totalChunks,
            bytesTransferred,
            totalBytes: fileSize,
            percentage: Math.round((bytesTransferred / fileSize) * 100),
            speedBps: elapsed > 0 ? bytesTransferred / elapsed : 0,
        });
    }

    private checkAssemblyReady(): void {
        if (
            this.expectedTotalChunks !== null &&
            this.receivedChunks.size >= this.expectedTotalChunks
        ) {
            this.assemble();
        }
    }

    private async assemble(): Promise<void> {
        const { totalChunks, fileName, contentType } = this.sessionInfo!;

        this.receiverState.set('assembling');

        const ordered = Array.from({ length: totalChunks }, (_, i) => this.receivedChunks.get(i)!);
        const blob = new Blob(ordered, { type: contentType || 'application/octet-stream' });
        this.receivedChunks.clear();

        this.receiverState.set('verifying');
        let hashOk: boolean;
        try {
            hashOk = await this.hasher.verifyHash(blob, this.expectedFileHash!);
        } catch (err) {
            hashOk = false;
            console.error('[BURN] Hash verification error:', err);
        }

        if (!hashOk) {
            this.receiverState.set('error');
            this.errorMessage.set('Verifica integrità fallita: il file potrebbe essere corrotto.');
            await this.supabase.sendSignal(this.receiverLinkId!, {
                type: 'hash-error',
                from: 'receiver',
                timestamp: Date.now(),
            }).catch(() => {});
            return;
        }

        this.receiverState.set('completed');
        this.onCompleteCallback?.(blob, fileName);
    }

    // ─── Common helpers ──────────────────────────────────────────

    private authHeaders(): Record<string, string> {
        return { 'X-Bam-Api-Key': environment.r2.apiKey };
    }
}
