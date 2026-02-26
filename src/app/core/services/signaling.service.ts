import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CryptoService } from './crypto.service';
import { AdService } from './ad.service';
import { SenderEngineService } from './transfer/sender-engine.service';
import { ReceiverEngineService } from './transfer/receiver-engine.service';
import { HasherService } from './transfer/hasher.service';
import { ConnectionStatus, ReceiverSession, SenderSession } from './transfer/transfer.types';
import { RealtimeChannel } from '@supabase/supabase-js';
import { ReplaySubject, Subject, Subscription } from 'rxjs';

export interface SignalingMessage {
    type: 'offer' | 'answer' | 'candidate' | 'ready' | 'error' | 'retry';
    from: 'sender' | 'receiver';
    data?: any;
    timestamp: number;
}

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
}

@Injectable({
    providedIn: 'root'
})
export class SignalingService {
    private channels = new Map<string, RealtimeChannel>();
    private activeSessions = new Map<string, FileShareSession>();
    private transferSubs = new Map<string, Subscription>();

    // Per-session transfer engine sessions
    private senderSessions = new Map<string, SenderSession>();
    private receiverSessions = new Map<string, ReceiverSession>();

    private sessionUpdates$ = new ReplaySubject<FileShareSession>(10);
    private signalingErrors$ = new Subject<{ linkId: string; error: string }>();

    /** Expose engine progress signals directly for UI binding */
    readonly senderProgress = this.senderEngine.progress;
    readonly receiverProgress = this.receiverEngine.progress;

    constructor(
        private supabase: SupabaseService,
        private crypto: CryptoService,
        private adService: AdService,
        private senderEngine: SenderEngineService,
        private receiverEngine: ReceiverEngineService,
        private hasher: HasherService,
    ) {
    }

    // ═══════════════════════════════════════════════════════
    // SENDER FLOW
    // ═══════════════════════════════════════════════════════

    async startSenderSession(
        file: File,
        mode: 'burn' | 'seed',
        password?: string,
        onHashProgress?: (progress: number) => void,
        customSlug?: string
    ): Promise<{ linkId: string; session: FileShareSession }> {
        try {
            if (mode === 'seed' && !this.supabase.isAuthenticated()) {
                throw new Error('La condivisione persistente è disponibile solo per utenti registrati.');
            }

            const linkId = this.crypto.generateLinkId(12);

            // Hash file using new HasherService
            console.time('HasherService.calculateHash');
            const fileHash = await this.hasher.calculateHash(file, onHashProgress);
            console.timeEnd('HasherService.calculateHash');

            const session: FileShareSession = {
                linkId,
                fileInfo: {
                    name: file.name,
                    size: file.size,
                    hash: fileHash,
                    mimeType: file.type
                },
                mode,
                passwordProtected: !!password,
                status: 'waiting',
                createdAt: new Date()
            };

            this.activeSessions.set(linkId, session);

            // Create DB record
            const userId = this.supabase.currentUser()?.id || null;
            const transferData: any = {
                sender_id: userId,
                file_name: file.name,
                file_size: file.size,
                file_hash: fileHash,
                mode,
                link_id: linkId,
                password_protected: !!password
            };
            if (customSlug) {
                transferData.custom_slug = customSlug;
            }

            try {
                await this.supabase.createFileTransfer(transferData);
            } catch (e: any) {
                if (customSlug && e?.message?.includes('custom_slug')) {
                    console.warn('custom_slug column not found in DB, retrying without it');
                    delete transferData.custom_slug;
                    await this.supabase.createFileTransfer(transferData);
                } else {
                    throw e;
                }
            }

            if (!this.supabase.isPremium()) {
                await this.supabase.incrementDailyFileCount();
            }

            await this.setupSenderSignaling(linkId, file, session, password);
            return { linkId, session };
        } catch (error: any) {
            throw new Error(`Failed to start sender session: ${error.message}`);
        }
    }

    private async setupSenderSignaling(linkId: string, file: File, session: FileShareSession, password?: string) {
        console.log(`Setting up sender signaling for ${linkId}`);

        const precomputedHash = session?.fileInfo.hash;

        const initSenderSession = () => {
            // Cleanup previous signal subscription
            const prevSub = this.transferSubs.get(`sender-signal-${linkId}`);
            if (prevSub) {
                prevSub.unsubscribe();
                this.transferSubs.delete(`sender-signal-${linkId}`);
            }

            const newSession = this.senderEngine.initSender(file, {
                password: password || undefined,
                precomputedHash,
            });
            this.senderSessions.set(linkId, newSession);

            // Relay outgoing signals (SDP offer, ICE candidates) to Supabase
            const signalSub = newSession.signalOut.subscribe(async (signal) => {
                const msgType: 'offer' | 'candidate' = signal.type === 'offer' ? 'offer' : 'candidate';
                await this.sendSignal(linkId, {
                    type: msgType,
                    from: 'sender',
                    data: signal,
                    timestamp: Date.now()
                });
            });
            this.transferSubs.set(`sender-signal-${linkId}`, signalSub);

            return newSession;
        };

        let senderSession = initSenderSession();

        // Subscribe to Supabase signaling channel
        const channel = await this.supabase.subscribeToSignaling(linkId, async (payload) => {
            const message: SignalingMessage = payload.payload;
            console.log(`Sender received signal: ${message.type} from ${message.from}`);

            if (message.type === 'ready' && message.from === 'receiver') {
                // Re-initialize sender if previous attempt failed (retry scenario)
                if (!this.senderSessions.has(linkId)) {
                    console.log('[SENDER] re-initializing after retry');
                    senderSession = initSenderSession();
                }

                this.updateSessionStatus(linkId, 'connecting');
                try {
                    await this.startSenderTransfer(linkId, senderSession);
                } catch (e) {
                    throw e;
                }
            } else if (message.from === 'receiver' && (message.type === 'answer' || message.type === 'candidate')) {
                // Forward incoming signals to the transfer engine
                senderSession.signalIn(message.data);
            }
        });

        this.channels.set(linkId, channel);
    }

    private async startSenderTransfer(linkId: string, senderSession: SenderSession) {
        if (!senderSession) return;

        // Watch SenderEngine state changes + progress
        const stateCheckInterval = setInterval(() => {
            const state = this.senderEngine.state();
            switch (state) {
                case 'connecting':
                    this.updateSessionStatus(linkId, 'connecting');
                    break;
                case 'stabilizing':
                    this.updateSessionStatus(linkId, 'connected');
                    break;
                case 'transferring':
                    this.updateSessionStatus(linkId, 'transferring');
                    break;
                case 'completed':
                    this.updateSessionStatus(linkId, 'completed');
                    clearInterval(stateCheckInterval);
                    break;
                case 'error':
                    this.updateSessionStatus(linkId, 'error');
                    clearInterval(stateCheckInterval);
                    break;
            }

        }, 100);

        try {
            await senderSession.startTransfer();

            // startTransfer() sets state='completed' as its last step, but the interval
            // is cleared by finally{} before it can tick. Emit 'completed' explicitly.
            this.updateSessionStatus(linkId, 'completed');

            // Post-transfer actions
            if (this.supabase.isAuthenticated()) {
                await this.supabase.addXP(10);
            }
            await this.adService.onTransferComplete();

            // Seed mode: immediately mark session as available for the next receiver,
            // then do a short grace-period before closing the peer connections so the
            // receiver has time to save the file after sending ack-complete.
            const session = this.activeSessions.get(linkId);
            if (session?.mode === 'seed') {
                // Delete the session reference NOW so the next 'ready' signal triggers
                // a fresh initSenderSession() instead of reusing this stale closure.
                this.senderSessions.delete(linkId);
                this.updateSessionStatus(linkId, 'waiting');
                // Deferred cleanup: only run if no new session has taken over.
                setTimeout(() => {
                    if (!this.senderSessions.has(linkId)) {
                        this.senderEngine.cleanup();
                    }
                }, 500);
            }
        } catch (error: any) {
            const session = this.activeSessions.get(linkId);
            if (session?.status === 'completed') {
                console.log('Ignored error after completion:', error);
                return;
            }

            // Connection failure (timeout or ICE error) → cleanup and request receiver retry
            if (error.message?.includes('Connection timeout') || error.message?.includes('Connection failed')) {
                console.warn(`[SENDER] connection error — requesting receiver retry: ${error.message}`);
                this.senderEngine.cleanup();
                this.senderSessions.delete(linkId);

                // Signal receiver to reload and retry
                await this.sendSignal(linkId, {
                    type: 'retry',
                    from: 'sender',
                    timestamp: Date.now(),
                });

                this.updateSessionStatus(linkId, 'retry-waiting');
                return;
            }

            this.updateSessionStatus(linkId, 'error');
            this.signalingErrors$.next({ linkId, error: error.message });
        } finally {
            clearInterval(stateCheckInterval);
        }
    }

    // ═══════════════════════════════════════════════════════
    // RECEIVER FLOW
    // ═══════════════════════════════════════════════════════

    async joinReceiverSession(linkId: string): Promise<FileShareSession> {
        try {
            const transfer = await this.supabase.getFileTransfer(linkId);

            if (!transfer) {
                throw new Error('File transfer not found');
            }

            if (transfer.status !== 'active') {
                throw new Error(`Transfer is ${transfer.status}`);
            }

            const session: FileShareSession = {
                linkId,
                fileInfo: {
                    name: transfer.file_name,
                    size: transfer.file_size,
                    hash: transfer.file_hash
                },
                mode: transfer.mode,
                passwordProtected: transfer.password_protected,
                status: 'waiting',
                createdAt: new Date(transfer.created_at)
            };

            this.activeSessions.set(linkId, session);
            await this.setupReceiverSignaling(linkId);

            // Notify sender that receiver is ready
            await this.sendSignal(linkId, {
                type: 'ready',
                from: 'receiver',
                timestamp: Date.now()
            });

            return session;
        } catch (error: any) {
            throw new Error(`Failed to join receiver session: ${error.message}`);
        }
    }

    private async setupReceiverSignaling(linkId: string) {
        console.log(`Setting up receiver signaling for ${linkId}`);

        // Queue to ensure signals are processed sequentially
        let signalQueue: Promise<void> = Promise.resolve();
        const pendingSignals: SignalingMessage[] = [];

        const channel = await this.supabase.subscribeToSignaling(linkId, async (payload) => {
            const message: SignalingMessage = payload.payload;
            console.log(`Receiver received signal: ${message.type} from ${message.from}`);

            if (message.from === 'sender') {
                // Retry signal: sender's connection timed out, re-initialize
                if (message.type === 'retry') {
                    console.log('[RECEIVER] retry requested by sender — re-initializing');
                    const existingSession = this.receiverSessions.get(linkId);
                    if (existingSession) {
                        existingSession.cancel();
                        this.receiverSessions.delete(linkId);
                    }
                    this.receiverEngine.cleanup();
                    pendingSignals.length = 0;
                    signalQueue = Promise.resolve();

                    this.updateSessionStatus(linkId, 'connecting');

                    // Re-notify sender that receiver is ready
                    await this.sendSignal(linkId, {
                        type: 'ready',
                        from: 'receiver',
                        timestamp: Date.now(),
                    });
                    return;
                }

                // Initialize receiver session on first offer
                let receiverSession = this.receiverSessions.get(linkId);

                if (!receiverSession && message.type === 'offer') {
                    this.updateSessionStatus(linkId, 'connecting');
                    receiverSession = this.initReceiverSession(linkId);
                }

                if (!receiverSession) {
                    // Buffer signals that arrive before the offer
                    console.log(`Receiver: buffering signal ${message.type} (no session yet)`);
                    pendingSignals.push(message);
                    return;
                }

                // Process sequentially to avoid race conditions
                signalQueue = signalQueue.then(async () => {
                    // Flush any pending signals first
                    while (pendingSignals.length > 0) {
                        const pending = pendingSignals.shift()!;
                        console.log(`Receiver: flushing buffered signal ${pending.type}`);
                        await receiverSession!.signalIn(pending.data);
                    }
                    await receiverSession!.signalIn(message.data);
                }).catch(err => {
                    console.error('Receiver signalIn error:', err);
                });
            }
        });

        this.channels.set(linkId, channel);
    }

    private initReceiverSession(linkId: string): ReceiverSession {
        const receiverSession = this.receiverEngine.initReceiver();

        this.receiverSessions.set(linkId, receiverSession);

        // Relay outgoing signals
        const signalSub = receiverSession.signalOut.subscribe(async (signal) => {
            const msgType: 'answer' | 'candidate' = signal.type === 'answer' ? 'answer' : 'candidate';
            await this.sendSignal(linkId, {
                type: msgType,
                from: 'receiver',
                data: signal,
                timestamp: Date.now()
            });
        });
        this.transferSubs.set(`receiver-signal-${linkId}`, signalSub);

        // Watch ReceiverEngine state changes
        const stateCheckInterval = setInterval(() => {
            const state = this.receiverEngine.state();
            switch (state) {
                case 'connecting':
                    this.updateSessionStatus(linkId, 'connecting');
                    break;
                case 'stabilizing':
                case 'transferring':
                    this.updateSessionStatus(linkId, 'transferring');
                    break;
                case 'completed':
                    this.updateSessionStatus(linkId, 'completed');
                    clearInterval(stateCheckInterval);
                    break;
                case 'error':
                    this.updateSessionStatus(linkId, 'error');
                    clearInterval(stateCheckInterval);
                    break;
            }
        }, 100);

        return receiverSession;
    }

    /**
     * Compatibility wrapper: components call this to receive the file.
     * The new engine handles everything via Observables.
     */
    receiveFile(
        linkId: string,
        onProgress?: (progress: any) => void,
        onComplete?: (file: Blob, meta: any) => void | Promise<void>,
        password?: string
    ): Subscription {
        this.updateSessionStatus(linkId, 'transferring');

        // If we have a receiver session, subscribe to its file output
        let receiverSession = this.receiverSessions.get(linkId);
        if (!receiverSession) {
            // Initialize with password
            receiverSession = this.receiverEngine.initReceiver(password ? { password } : undefined);
            this.receiverSessions.set(linkId, receiverSession);
        }

        // Watch progress from receiver engine
        const progressInterval = setInterval(() => {
            const progress = this.receiverEngine.progress();
            if (progress && onProgress) {
                onProgress({
                    percentage: progress.percentage,
                    speed: progress.speed,
                    bytesTransferred: progress.bytesTransferred,
                    totalBytes: progress.totalBytes,
                });
            }
        }, 200);

        // Subscribe to file output
        const subscription = receiverSession.onFile.subscribe({
            next: async ({ blob, metadata }) => {
                clearInterval(progressInterval);
                this.updateSessionStatus(linkId, 'completed');

                try {
                    await this.supabase.incrementDownloadCount(linkId);
                } catch (e) {
                    console.warn('incrementDownloadCount failed', e);
                }

                if (onComplete) {
                    try {
                        await Promise.resolve(onComplete(blob, metadata));
                    } catch (e) {
                        console.error('onComplete handler failed', e);
                    }
                }

                await this.adService.onTransferComplete();

                const session = this.activeSessions.get(linkId);
                if (session?.mode === 'burn') {
                    await this.delay(1000);
                    this.closeSession(linkId);
                    try {
                        await this.supabase.updateTransferStatus(linkId, 'completed');
                    } catch (e) {
                        console.warn('updateTransferStatus failed', e);
                    }
                }
            },
            error: (error) => {
                clearInterval(progressInterval);
                this.updateSessionStatus(linkId, 'error');
                console.error('Error receiving file:', error);
            }
        });

        return subscription;
    }

    /**
     * sendFileWhenReady — waits for transfer completion.
     * Progress is available via senderProgress signal (bound directly in template).
     */
    async sendFileWhenReady(linkId: string) {
        return new Promise<void>((resolve, reject) => {
            const checkInterval = setInterval(() => {
                const state = this.senderEngine.state();
                if (state === 'completed') {
                    clearInterval(checkInterval);
                    resolve();
                } else if (state === 'error') {
                    clearInterval(checkInterval);
                    reject(new Error('Transfer failed'));
                }
            }, 100);
        });
    }

    // ═══════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════

    private async sendSignal(linkId: string, message: SignalingMessage) {
        await this.supabase.sendSignal(linkId, message);
    }

    private updateSessionStatus(linkId: string, status: ConnectionStatus) {
        const session = this.activeSessions.get(linkId);
        if (session) {
            session.status = status;
            this.sessionUpdates$.next(session);
        }
    }

    getSession(linkId: string): FileShareSession | undefined {
        return this.activeSessions.get(linkId);
    }

    closeSession(linkId: string) {
        this.senderEngine.cleanup();
        this.receiverEngine.cleanup();

        // Cancel active transfer sessions
        this.senderSessions.get(linkId)?.cancel();
        this.senderSessions.delete(linkId);
        this.receiverSessions.get(linkId)?.cancel();
        this.receiverSessions.delete(linkId);

        // Unsubscribe from Supabase channel
        const channel = this.channels.get(linkId);
        if (channel) {
            channel.unsubscribe();
            this.channels.delete(linkId);
        }

        // Cleanup transfer subs
        for (const [key, sub] of this.transferSubs) {
            if (key.includes(linkId)) {
                sub.unsubscribe();
                this.transferSubs.delete(key);
            }
        }

        this.activeSessions.delete(linkId);
    }

    terminateWorkers() {
        this.hasher.terminateWorker();
    }

    getSessionUpdates$() {
        return this.sessionUpdates$.asObservable();
    }

    getSignalingErrors$() {
        return this.signalingErrors$.asObservable();
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    cleanup() {
        this.activeSessions.forEach((_, linkId) => {
            this.closeSession(linkId);
        });
    }
}
