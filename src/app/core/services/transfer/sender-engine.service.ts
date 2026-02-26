import { Injectable, signal } from '@angular/core';
import { merge, Subject } from 'rxjs';
import { ConnectionService } from './connection.service';
import { ChannelPoolService } from './channel-pool.service';
import { ParallelConnection, ParallelConnectionPoolService } from './parallel-connection-pool.service';
import { getParallelConnectionCount, TRANSFER_CONFIG } from './transfer.config';
import {
    AdaptiveParams,
    ChannelRange,
    ChunkReaderMessage,
    ControlMessage,
    FileMetadata,
    ParallelSignal,
    SenderSession,
    TransferProgress,
    TransferState,
} from './transfer.types';

@Injectable({ providedIn: 'root' })
export class SenderEngineService {
    // ─── Public signals ────────────────────────────────────
    readonly state = signal<TransferState>('idle');
    readonly progress = signal<TransferProgress | null>(null);
    readonly activeChannels = signal(0);

    // ─── Private state ─────────────────────────────────────
    private pc: RTCPeerConnection | null = null;
    private worker: Worker | null = null;
    private adaptiveParams: AdaptiveParams | null = null;
    private cancelled = false;
    private transferStartTime = 0;

    // ─── Parallel mode state ───────────────────────────────
    private parallelConnections: ParallelConnection[] = [];
    private useParallelMode = false;

    constructor(
        private connection: ConnectionService,
        private channelPool: ChannelPoolService,
        private parallelPool: ParallelConnectionPoolService,
    ) {
    }

    // ═══════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════

    initSender(file: File, options: { password?: string; precomputedHash: string }): SenderSession {
        // Close any lingering connections from the previous transfer
        this.cleanup();

        this.cancelled = false;
        this.state.set('idle');
        this.progress.set(null);

        // Decisione: parallel o legacy? (pre-check basato su file size)
        // La decisione finale avviene dopo il profiling di PC0
        this.useParallelMode = TRANSFER_CONFIG.ENABLE_PARALLEL_MODE
            && file.size >= TRANSFER_CONFIG.PARALLEL_SIZE_THRESHOLD_2;

        if (this.useParallelMode) {
            console.log('[SENDER] Using parallel mode (3 PC)');
            return this.initSenderParallel(file, options);
        }

        console.log('[SENDER] Using legacy mode (1 PC)');
        return this.initSenderLegacy(file, options);
    }

    // ═══════════════════════════════════════════════════════
    // LEGACY MODE (original implementation)
    // ═══════════════════════════════════════════════════════

    private initSenderLegacy(file: File, options: { password?: string; precomputedHash: string }): SenderSession {
        const signalOut$ = new Subject<any>();
        const pendingCandidates: RTCIceCandidateInit[] = [];
        const fileHash = options.precomputedHash;

        const signalIn = (signal: any) => {
            this.handleSignalIn(signal, pendingCandidates);
        };

        const startTransfer = async (): Promise<void> => {
            try {
                // 1. Create PeerConnection (no offer yet)
                this.createPeerConnection(signalOut$);
                if (this.cancelled) return;

                // 2. Create DataChannels before offer (so they're included in SDP)
                const ranges = this.prepareChannels(file.size);

                // 3. Create and send offer (channels are now in SDP)
                await this.createAndSendOffer(signalOut$);
                if (this.cancelled) return;

                // 4. Wait for connection + stability + profiling
                await this.waitForReady();
                if (this.cancelled) return;

                // 5. Wait for all channels to open
                await this.channelPool.waitForAllOpen();
                this.activeChannels.set(this.channelPool.activeChannelCount());
                if (this.cancelled) return;

                // 6. Prepare encryption (optional)
                this.state.set('transferring');
                const encryption = options?.password
                    ? await this.prepareEncryption(options.password)
                    : null;

                // 7. Build and send metadata
                const metadata: FileMetadata = {
                    name: file.name,
                    size: file.size,
                    mimeType: file.type,
                    hash: fileHash,
                    channelCount: this.adaptiveParams!.channelCount,
                    ranges,
                    ...(encryption?.metadataEncryption && { encryption: encryption.metadataEncryption }),
                };

                await this.sendMetadata(metadata);
                if (this.cancelled) return;

                // 7b. Install progress-report listener on ch0
                this.installProgressReportListener();

                // 8. Pump chunks via worker
                this.transferStartTime = Date.now();
                const totalBytesSent = await this.pumpChunks(file, ranges, encryption?.key, encryption?.salt);

                // 9. Wait for SCTP buffers to fully drain
                await this.channelPool.waitForAllBuffersDrained();

                // 10. Log transfer stats
                const elapsed = (Date.now() - this.transferStartTime) / 1000;
                const avgSpeed = totalBytesSent / elapsed;
                const chStats = this.channelPool.channels().map(ch =>
                    `ch${ch.index}:${(ch.bytesSent / (1024 * 1024)).toFixed(1)}MB`
                ).join(' ');
                console.log(`[SENDER] transfer done — ${(totalBytesSent / (1024 * 1024)).toFixed(1)}MB in ${elapsed.toFixed(1)}s ` +
                    `(avg ${this.formatSpeed(avgSpeed)}) | ${chStats}`);

                // 11. Send transfer-complete with byte count
                this.channelPool.sendControl({ type: 'transfer-complete', totalBytesSent });

                // 12. Wait for receiver to confirm (hash verified)
                await this.waitForControlMessage('ack-complete', TRANSFER_CONFIG.ACK_COMPLETE_TIMEOUT);
                this.state.set('completed');
                console.log('[SENDER] ✓ transfer verified by receiver');

            } catch (err: any) {
                if (!this.cancelled) {
                    console.error('[SENDER] transfer error:', err.message);
                    this.state.set('error');
                    throw err;
                }
            }
        };

        const cancel = () => {
            this.cancelled = true;
            this.cleanup();
        };

        return { signalOut: signalOut$.asObservable(), signalIn, startTransfer, cancel };
    }

    // ═══════════════════════════════════════════════════════
    // PARALLEL MODE
    // ═══════════════════════════════════════════════════════

    private initSenderParallel(file: File, options: { password?: string; precomputedHash: string }): SenderSession {
        const signalOut$ = new Subject<ParallelSignal>();
        const fileHash = options.precomputedHash;

        const signalIn = (signal: ParallelSignal | any) => {
            // Handle both ParallelSignal and legacy signal formats
            if ('connectionIndex' in signal) {
                this.parallelPool.handleSignalIn(signal as ParallelSignal);
            }
        };

        const startTransfer = async (): Promise<void> => {
            try {
                // ── Phase 1: Crea tutte le PC (max configurato) ────────
                this.state.set('connecting');

                // Crea subito il numero massimo di PC (4)
                const maxPCs = TRANSFER_CONFIG.PARALLEL_CONNECTIONS;
                this.parallelConnections = this.parallelPool.createSenderConnections(file.size, maxPCs);

                // Sottoscrivi signalOut$ di tutte le PC
                const allSignals$ = merge(...this.parallelConnections.map(conn => conn.signalOut$));
                allSignals$.subscribe(s => signalOut$.next(s));

                // ── Phase 2: PC0 setup + profiling ──────────────────
                // Crea offer SOLO per PC0 inizialmente
                const pc0 = this.parallelConnections[0];
                const offer0 = await this.connection.createOffer(pc0.pc);
                pc0.signalOut$.next({
                    connectionIndex: 0,
                    type: 'offer',
                    offer: offer0,
                });

                if (this.cancelled) return;

                // Aspetta PC0 connessa
                await this.connection.waitForConnection(pc0.pc);
                if (this.cancelled) return;

                // Profiling PC0
                this.state.set('stabilizing');
                await this.connection.verifyStability(pc0.pc);
                const profile = await this.connection.profileConnection(pc0.pc);
                this.adaptiveParams = this.connection.calculateAdaptiveParams(profile);

                // Decisione finale: quante PC servono?
                const connectionCount = getParallelConnectionCount(file.size, profile.type);
                this.parallelPool.setMaxBufferedAmount(this.adaptiveParams.maxBufferedAmount);

                console.log(`[SENDER] PC0 connected — ${profile.type} (RTT: ${profile.rttMs.toFixed(1)}ms) → ${connectionCount} parallel PC`);

                if (this.cancelled) return;

                // ── Phase 3: PC aggiuntive (se necessario) ──────────
                if (connectionCount > 1) {
                    // Crea offer per le PC aggiuntive
                    console.log(`[SENDER] Creating offers for ${connectionCount - 1} additional PCs`);
                    for (let i = 1; i < connectionCount; i++) {
                        const conn = this.parallelConnections[i];
                        const offer = await this.connection.createOffer(conn.pc);
                        conn.signalOut$.next({
                            connectionIndex: i,
                            type: 'offer',
                            offer,
                        });
                    }

                    if (this.cancelled) return;

                    // Aspetta tutte le PC connesse
                    const activeConnections = this.parallelConnections.slice(0, connectionCount);
                    await Promise.all(
                        activeConnections.map(async (conn) => {
                            await this.connection.waitForConnection(conn.pc);
                            await this.connection.verifyStability(conn.pc);
                        })
                    );
                    if (this.cancelled) return;
                }

                // ── Phase 4: Chiudi PC in eccesso (SEMPRE) ──────────
                if (connectionCount < maxPCs) {
                    console.log(`[SENDER] Closing ${maxPCs - connectionCount} unused PCs`);
                    for (let i = connectionCount; i < maxPCs; i++) {
                        const conn = this.parallelConnections[i];
                        if (conn.dc) {
                            conn.dc.close();
                        }
                        conn.pc.close();
                        conn.status = 'done';
                    }
                }

                // Aggiorna array e pool (SEMPRE)
                this.parallelConnections = this.parallelConnections.slice(0, connectionCount);
                this.parallelPool.connections.set(this.parallelConnections);

                // ── CRITICAL: Ricalcola range per le PC effettivamente usate ──
                const finalRanges = this.parallelPool.assignRanges(file.size, connectionCount);
                for (let i = 0; i < connectionCount; i++) {
                    this.parallelConnections[i].range = finalRanges[i];
                }
                console.log(`[SENDER] Active connections: ${connectionCount}, ranges recalculated for ${file.size} bytes`);

                // Aspetta tutti i DataChannels aperti (solo delle PC attive)
                await this.parallelPool.waitForAllChannelsOpen();
                if (this.cancelled) return;

                // ── Phase 3: Transfer ───────────────────────────────
                this.state.set('transferring');

                const encryption = options?.password
                    ? await this.prepareEncryption(options.password)
                    : null;

                // Metadata — inviato su DC0 (ordered, controllo)
                const ranges = this.parallelConnections.map(c => c.range);
                const metadata: FileMetadata = {
                    name: file.name,
                    size: file.size,
                    mimeType: file.type,
                    hash: fileHash,
                    channelCount: connectionCount,
                    ranges,
                    ...(encryption?.metadataEncryption && { encryption: encryption.metadataEncryption }),
                };

                this.parallelPool.sendControl({ type: 'metadata', metadata });
                await this.waitForControlMessageParallel('ack-metadata');
                if (this.cancelled) return;

                this.installProgressReportListenerParallel();

                // Pump chunks
                this.transferStartTime = Date.now();
                const totalBytesSent = await this.pumpChunksParallel(file, ranges, encryption?.key, encryption?.salt);

                await this.parallelPool.waitForAllBuffersDrained();

                // Stats
                const elapsed = (Date.now() - this.transferStartTime) / 1000;
                const avgSpeed = totalBytesSent / elapsed;
                const connStats = this.parallelConnections
                    .map(c => `PC${c.index}:${(c.bytesSent / (1024 * 1024)).toFixed(1)}MB`)
                    .join(' ');
                console.log(
                    `[SENDER] transfer done — ${(totalBytesSent / (1024 * 1024)).toFixed(1)}MB in ${elapsed.toFixed(1)}s ` +
                    `(avg ${this.formatSpeed(avgSpeed)}) | ${connStats}`
                );

                // Transfer complete + ack
                this.parallelPool.sendControl({ type: 'transfer-complete', totalBytesSent });
                await this.waitForControlMessageParallel('ack-complete', TRANSFER_CONFIG.ACK_COMPLETE_TIMEOUT);
                this.state.set('completed');
                console.log('[SENDER] ✓ transfer verified by receiver');

            } catch (err: any) {
                if (!this.cancelled) {
                    console.error('[SENDER] transfer error:', err.message);
                    this.state.set('error');
                    throw err;
                }
            }
        };

        const cancel = () => {
            this.cancelled = true;
            this.cleanupParallel();
        };

        return { signalOut: signalOut$.asObservable(), signalIn, startTransfer, cancel };
    }

    private async pumpChunksParallel(
        file: File,
        ranges: ChannelRange[],
        encryptionKey?: ArrayBuffer,
        salt?: ArrayBuffer,
    ): Promise<number> {
        return new Promise((resolve, reject) => {
            this.terminateWorker();

            this.worker = new Worker(
                new URL('../../workers/chunk-reader.worker', import.meta.url),
                { type: 'module' },
            );

            let totalBytesSent = 0;
            let workerDone = false;
            let workerError: string | null = null;
            let rejected = false;

            // ── Per-connection queues ─────────────────────────────
            const connectionQueues = new Map<number, ChunkReaderMessage[]>();
            const connectionDraining = new Map<number, boolean>();

            for (const conn of this.parallelConnections) {
                connectionQueues.set(conn.index, []);
                connectionDraining.set(conn.index, false);
            }

            const checkDone = () => {
                if (rejected) return;
                if (workerError) {
                    rejected = true;
                    reject(new Error(`[SENDER] worker error: ${workerError}`));
                    return;
                }
                if (!workerDone) return;

                for (const [, q] of connectionQueues) {
                    if (q.length > 0) return;
                }
                for (const [, draining] of connectionDraining) {
                    if (draining) return;
                }

                resolve(totalBytesSent);
            };

            const drainConnection = async (connIndex: number) => {
                if (connectionDraining.get(connIndex)) return;
                connectionDraining.set(connIndex, true);

                const queue = connectionQueues.get(connIndex)!;
                const conn = this.parallelConnections.find(c => c.index === connIndex);

                while (queue.length > 0 && !this.cancelled && !rejected) {
                    const msg = queue.shift()!;
                    try {
                        if (msg.type === 'chunk' && conn) {
                            await this.parallelPool.sendChunk(conn, msg.packet, msg.dataSize);
                            totalBytesSent += msg.dataSize;
                        } else if (msg.type === 'channel-done' && conn) {
                            conn.status = 'done';
                            this.parallelPool.sendControl({
                                type: 'channel-done',
                                channelIndex: connIndex,
                                bytesSent: conn.bytesSent,
                            });
                        }
                    } catch (err) {
                        if (!rejected) {
                            rejected = true;
                            reject(err instanceof Error ? err : new Error(String(err)));
                        }
                        connectionDraining.set(connIndex, false);
                        return;
                    }
                }

                connectionDraining.set(connIndex, false);
                checkDone();
            };

            // Worker message handler
            this.worker.onmessage = ({ data: msg }: MessageEvent<ChunkReaderMessage>) => {
                if (rejected) return;

                switch (msg.type) {
                    case 'chunk':
                    case 'channel-done': {
                        const queue = connectionQueues.get(msg.channelIndex);
                        if (queue) {
                            queue.push(msg);
                            drainConnection(msg.channelIndex);
                        }
                        break;
                    }
                    case 'done':
                        workerDone = true;
                        checkDone();
                        break;
                    case 'error':
                        workerError = msg.message;
                        checkDone();
                        break;
                }
            };

            this.worker.onerror = (e) => {
                if (!rejected) {
                    rejected = true;
                    reject(new Error(`[SENDER] worker crash: ${e.message}`));
                }
            };

            // Start worker
            const cmd: any = {
                command: 'start',
                file,
                ranges,
                chunkSize: this.adaptiveParams?.chunkSize ?? TRANSFER_CONFIG.CHUNK_SIZE_DEFAULT,
            };
            if (encryptionKey) cmd.encryptionKey = encryptionKey;
            if (salt) cmd.salt = salt;

            this.worker.postMessage(cmd);
        });
    }

    private waitForControlMessageParallel(type: string, timeoutMs?: number): Promise<ControlMessage> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`[SENDER] timeout waiting for ${type}`));
            }, timeoutMs ?? TRANSFER_CONFIG.METADATA_ACK_TIMEOUT);

            const conn0 = this.parallelConnections[0];
            if (!conn0?.dc || conn0.dc.readyState !== 'open') {
                clearTimeout(timeout);
                reject(new Error('[SENDER] control channel (PC0) not ready'));
                return;
            }

            const originalHandler = conn0.dc.onmessage;

            conn0.dc.onmessage = (event) => {
                if (typeof event.data === 'string') {
                    try {
                        const msg: ControlMessage = JSON.parse(event.data);
                        if (msg.type === type) {
                            clearTimeout(timeout);
                            conn0.dc!.onmessage = originalHandler;
                            resolve(msg);
                            return;
                        }
                    } catch { /* ignore */
                    }
                }
                if (originalHandler) {
                    (originalHandler as any)(event);
                }
            };
        });
    }

    private installProgressReportListenerParallel(): void {
        const conn0 = this.parallelConnections[0];
        if (!conn0?.dc) return;

        const originalHandler = conn0.dc.onmessage;

        conn0.dc.onmessage = (event) => {
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'progress-report') {
                        this.handleReceiverProgress(msg);
                        return;
                    }
                } catch { /* ignore */
                }
            }
            if (originalHandler) {
                (originalHandler as any)(event);
            }
        };
    }

    // ═══════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════

    cleanup(): void {
        this.terminateWorker();

        if (this.useParallelMode) {
            this.cleanupParallel();
        } else {
            this.channelPool.closeAll();
            if (this.pc) {
                this.connection.closePeerConnection(this.pc);
                this.pc = null;
            }
        }

        this.adaptiveParams = null;
    }

    private cleanupParallel(): void {
        this.terminateWorker();
        this.parallelPool.closeAll();
        this.parallelConnections = [];
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Connection setup
    // ═══════════════════════════════════════════════════════

    private createPeerConnection(signalOut$: Subject<any>): void {
        this.state.set('connecting');
        this.pc = this.connection.createPeerConnection();

        // Default adaptive params (recalculated after profiling)
        this.adaptiveParams = this.connection.calculateAdaptiveParams({
            type: 'wan',
            rttMs: 50,
            availableBitrate: 0,
            localCandidateType: 'unknown',
            remoteCandidateType: 'unknown',
        });

        // ICE candidate trickle
        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                signalOut$.next(event.candidate.toJSON());
            }
        };
    }

    private async createAndSendOffer(signalOut$: Subject<any>): Promise<void> {
        if (!this.pc) throw new Error('[SENDER] no PeerConnection for offer');
        const offer = await this.connection.createOffer(this.pc);
        signalOut$.next(offer);
    }

    private async waitForReady(): Promise<void> {
        if (!this.pc) throw new Error('[SENDER] no PeerConnection');

        await this.connection.waitForConnection(this.pc);
        this.state.set('stabilizing');
        await this.connection.verifyStability(this.pc);

        const profile = await this.connection.profileConnection(this.pc);
        this.adaptiveParams = this.connection.calculateAdaptiveParams(profile);
        this.channelPool.setMaxBufferedAmount(this.adaptiveParams.maxBufferedAmount);

        console.log(`[SENDER] connected — ${profile.type} (RTT: ${profile.rttMs.toFixed(1)}ms) | ` +
            `${this.adaptiveParams.channelCount}ch × ${(this.adaptiveParams.chunkSize / 1024).toFixed(0)}KB chunks | ` +
            `buffer: ${(this.adaptiveParams.maxBufferedAmount / (1024 * 1024)).toFixed(0)}MB`);
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Channel preparation
    // ═══════════════════════════════════════════════════════

    private prepareChannels(fileSize: number): ChannelRange[] {
        if (!this.pc || !this.adaptiveParams) {
            throw new Error('[SENDER] no PeerConnection or adaptiveParams');
        }

        const ranges = ChannelPoolService.assignRanges(fileSize, this.adaptiveParams.channelCount);
        this.channelPool.createSenderChannels(this.pc, this.adaptiveParams.channelCount, ranges);
        this.channelPool.setMaxBufferedAmount(this.adaptiveParams.maxBufferedAmount);

        return ranges;
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Encryption
    // ═══════════════════════════════════════════════════════

    private async prepareEncryption(password: string): Promise<{
        key: ArrayBuffer;
        salt: ArrayBuffer;
        metadataEncryption: FileMetadata['encryption'];
    }> {
        const salt = crypto.getRandomValues(new Uint8Array(16));

        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(password),
            'PBKDF2',
            false,
            ['deriveKey', 'deriveBits'],
        );

        const derivedKey = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: TRANSFER_CONFIG.PBKDF2_ITERATIONS, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt'],
        );

        const key = await crypto.subtle.exportKey('raw', derivedKey);

        const metadataEncryption: FileMetadata['encryption'] = {
            algo: 'AES-GCM',
            saltB64: btoa(String.fromCharCode(...salt)),
            iterations: TRANSFER_CONFIG.PBKDF2_ITERATIONS,
        };

        return { key, salt: salt.buffer, metadataEncryption };
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Metadata exchange
    // ═══════════════════════════════════════════════════════

    private async sendMetadata(metadata: FileMetadata): Promise<void> {
        this.channelPool.sendControl({ type: 'metadata', metadata });
        await this.waitForControlMessage('ack-metadata');
    }

    private waitForControlMessage(type: string, timeoutMs?: number): Promise<ControlMessage> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`[SENDER] timeout waiting for ${type}`));
            }, timeoutMs ?? TRANSFER_CONFIG.METADATA_ACK_TIMEOUT);

            const ch0 = this.channelPool.channels()[0];
            if (!ch0) {
                clearTimeout(timeout);
                reject(new Error('[SENDER] no control channel'));
                return;
            }

            const originalHandler = ch0.dc.onmessage;

            ch0.dc.onmessage = (event) => {
                if (typeof event.data === 'string') {
                    try {
                        const msg: ControlMessage = JSON.parse(event.data);
                        if (msg.type === type) {
                            clearTimeout(timeout);
                            ch0.dc.onmessage = originalHandler;
                            resolve(msg);
                            return;
                        }
                    } catch { /* ignore */
                    }
                }
                // Forward to original handler
                if (originalHandler) {
                    (originalHandler as any)(event);
                }
            };
        });
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Signal handling
    // ═══════════════════════════════════════════════════════

    private handleSignalIn(signal: any, pendingCandidates: RTCIceCandidateInit[]): void {
        if (!this.pc) return;

        if (signal.type === 'answer') {
            this.connection.setRemoteAnswer(this.pc, signal).then(() => {
                for (const candidate of pendingCandidates) {
                    this.connection.addIceCandidate(this.pc!, candidate);
                }
                pendingCandidates.length = 0;
            }).catch(err => {
                console.error('[SENDER] setRemoteAnswer failed:', err);
            });
        } else if (signal.candidate) {
            if (this.connection.hasRemoteDescription(this.pc)) {
                this.connection.addIceCandidate(this.pc, signal).catch(err => {
                    console.error('[SENDER] addIceCandidate failed:', err);
                });
            } else {
                pendingCandidates.push(signal);
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Chunk pumping (worker → DataChannels)
    // ═══════════════════════════════════════════════════════

    private pumpChunks(
        file: File,
        ranges: ChannelRange[],
        encryptionKey?: ArrayBuffer,
        salt?: ArrayBuffer,
    ): Promise<number> {
        return new Promise((resolve, reject) => {
            this.terminateWorker();

            this.worker = new Worker(
                new URL('../../workers/chunk-reader.worker', import.meta.url),
                { type: 'module' },
            );

            const channels = this.channelPool.channels();
            let totalBytesSent = 0;
            let workerDone = false;
            let workerError: string | null = null;
            let rejected = false;

            // ── Per-channel queues for true parallel sending ────
            // Each channel has its own FIFO queue and its own async drain loop.
            // This way ch0 backpressure does NOT block ch1/ch2/ch3.
            const channelQueues = new Map<number, ChunkReaderMessage[]>();
            const channelDraining = new Map<number, boolean>();

            for (const ch of channels) {
                channelQueues.set(ch.index, []);
                channelDraining.set(ch.index, false);
            }

            const checkDone = () => {
                if (rejected) return;
                if (workerError) {
                    rejected = true;
                    reject(new Error(`[SENDER] worker error: ${workerError}`));
                    return;
                }
                if (!workerDone) return;
                // All queues must be empty
                for (const [, q] of channelQueues) {
                    if (q.length > 0) return;
                }
                // All drain loops must have finished
                for (const [, draining] of channelDraining) {
                    if (draining) return;
                }
                // Log backpressure diagnostics
                const bpLog = Array.from(backpressureStats.entries())
                    .sort(([a], [b]) => a - b)
                    .map(([ch, s]) => `ch${ch}:${s.count}stalls/${(s.totalMs / 1000).toFixed(1)}s`)
                    .join(' ');
                console.log(`[SENDER] backpressure: ${bpLog}`);

                // 🧪 DIAGNOSTIC: Final throughput analysis
                const totalElapsed = (Date.now() - diagnosticStartTime) / 1000;
                const workerThroughput = (workerChunksReceived * (this.adaptiveParams?.chunkSize ?? TRANSFER_CONFIG.CHUNK_SIZE_DEFAULT)) / totalElapsed;
                const networkThroughput = (networkChunksSent * (this.adaptiveParams?.chunkSize ?? TRANSFER_CONFIG.CHUNK_SIZE_DEFAULT)) / totalElapsed;
                const backpressureSeconds = Array.from(backpressureStats.values()).reduce((sum, s) => sum + s.totalMs, 0) / 1000;
                const backpressurePercent = (backpressureSeconds / totalElapsed) * 100;

                console.log(
                    `🧪 [DIAGNOSTIC SUMMARY]\n` +
                    `  Worker throughput:   ${(workerThroughput / (1024 * 1024)).toFixed(2)} MB/s\n` +
                    `  Network throughput:  ${(networkThroughput / (1024 * 1024)).toFixed(2)} MB/s\n` +
                    `  Backpressure time:   ${backpressureSeconds.toFixed(1)}s / ${totalElapsed.toFixed(1)}s (${backpressurePercent.toFixed(1)}%)\n` +
                    `  Chunk size:          ${((this.adaptiveParams?.chunkSize ?? TRANSFER_CONFIG.CHUNK_SIZE_DEFAULT) / 1024).toFixed(0)} KB\n` +
                    `  Chunks sent:         ${networkChunksSent}\n` +
                    `  Buffer config:       MAX=${(this.channelPool['maxBufferedAmount'] / (1024 * 1024)).toFixed(0)}MB LOW=${(TRANSFER_CONFIG.LOW_WATER_MARK / (1024 * 1024)).toFixed(0)}MB`
                );
                resolve(totalBytesSent);
            };

            // ── Backpressure diagnostics ────
            const backpressureStats = new Map<number, { count: number; totalMs: number }>();
            for (const ch of channels) {
                backpressureStats.set(ch.index, { count: 0, totalMs: 0 });
            }

            // 🧪 DIAGNOSTIC: Track throughput and bottlenecks
            let workerChunksReceived = 0;
            let networkChunksSent = 0;
            const diagnosticStartTime = Date.now();
            let lastDiagnosticLog = Date.now();

            const drainChannel = async (chIndex: number) => {
                if (channelDraining.get(chIndex)) return;
                channelDraining.set(chIndex, true);

                const queue = channelQueues.get(chIndex)!;
                const channel = channels.find(ch => ch.index === chIndex);

                while (queue.length > 0) {
                    if (this.cancelled || rejected) break;

                    const msg = queue.shift()!;

                    try {
                        if (msg.type === 'chunk' && channel) {
                            const bpStart = performance.now();
                            await this.channelPool.sendChunk(channel, chIndex, msg.packet, msg.dataSize);
                            const bpTime = performance.now() - bpStart;

                            // 🧪 DIAGNOSTIC: Track network send completion
                            networkChunksSent++;

                            // Track if sendChunk had to wait for backpressure (>1ms = waited)
                            if (bpTime > 1) {
                                const stats = backpressureStats.get(chIndex)!;
                                stats.count++;
                                stats.totalMs += bpTime;
                            }
                            totalBytesSent += msg.dataSize;
                        } else if (msg.type === 'channel-done' && channel) {
                            channel.status = 'done';
                            this.channelPool.sendControl({
                                type: 'channel-done',
                                channelIndex: chIndex,
                                bytesSent: channel.bytesSent,
                            });
                        }
                    } catch (err) {
                        if (!rejected) {
                            rejected = true;
                            reject(err instanceof Error ? err : new Error(String(err)));
                        }
                        channelDraining.set(chIndex, false);
                        return;
                    }
                }

                channelDraining.set(chIndex, false);
                checkDone();
            };

            this.worker.onmessage = ({ data: msg }: MessageEvent<ChunkReaderMessage>) => {
                if (rejected) return;

                switch (msg.type) {
                    case 'chunk':
                    case 'channel-done': {
                        const queue = channelQueues.get(msg.channelIndex);
                        if (queue) {
                            queue.push(msg);
                            drainChannel(msg.channelIndex);
                        }

                        // 🧪 DIAGNOSTIC: Track worker throughput
                        if (msg.type === 'chunk') {
                            workerChunksReceived++;
                            const now = Date.now();
                            if (now - lastDiagnosticLog >= 2000) { // Log every 2s
                                const elapsed = (now - diagnosticStartTime) / 1000;
                                const workerRate = (workerChunksReceived * (this.adaptiveParams?.chunkSize ?? TRANSFER_CONFIG.CHUNK_SIZE_DEFAULT)) / elapsed;
                                const networkRate = (networkChunksSent * (this.adaptiveParams?.chunkSize ?? TRANSFER_CONFIG.CHUNK_SIZE_DEFAULT)) / elapsed;
                                const queueSizes = Array.from(channelQueues.entries())
                                    .map(([ch, q]) => `ch${ch}:${q.length}`)
                                    .join(' ');
                                console.log(
                                    `🧪 [DIAGNOSTIC] Worker: ${(workerRate / (1024 * 1024)).toFixed(1)} MB/s | ` +
                                    `Network: ${(networkRate / (1024 * 1024)).toFixed(1)} MB/s | ` +
                                    `Queues: ${queueSizes}`
                                );
                                lastDiagnosticLog = now;
                            }
                        }
                        break;
                    }
                    case 'done':
                        workerDone = true;
                        checkDone();
                        break;
                    case 'error':
                        workerError = msg.message;
                        checkDone();
                        break;
                }
            };

            this.worker.onerror = (e) => {
                if (!rejected) {
                    rejected = true;
                    reject(new Error(`[SENDER] worker crash: ${e.message}`));
                }
            };

            // Start the worker
            const cmd: any = {
                command: 'start',
                file,
                ranges,
                chunkSize: this.adaptiveParams?.chunkSize ?? TRANSFER_CONFIG.CHUNK_SIZE_DEFAULT,
            };
            if (encryptionKey) cmd.encryptionKey = encryptionKey;
            if (salt) cmd.salt = salt;

            this.worker.postMessage(cmd);
        });
    }

    // buildChunkPayload removed — worker now produces wire-ready packets

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Progress (driven by receiver reports via ch0)
    // ═══════════════════════════════════════════════════════

    /**
     * Installs a listener on ch0 that receives progress-report messages
     * from the receiver. The sender's progress signal mirrors the receiver's
     * actual download state — no local speed calculation needed.
     */
    private installProgressReportListener(): void {
        const ch0 = this.channelPool.channels()[0];
        if (!ch0) return;

        const originalHandler = ch0.dc.onmessage;

        ch0.dc.onmessage = (event) => {
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'progress-report') {
                        this.handleReceiverProgress(msg);
                        return;
                    }
                } catch { /* ignore parse errors */
                }
            }
            // Forward non-progress messages to original handler
            if (originalHandler) {
                (originalHandler as any)(event);
            }
        };
    }

    private handleReceiverProgress(report: {
        bytesReceived: number;
        totalBytes: number;
        speed: number;
        percentage: number
    }): void {
        const activeChCount = this.channelPool.activeChannelCount();
        const remaining = report.speed > 0
            ? (report.totalBytes - report.bytesReceived) / report.speed
            : 0;

        this.progress.set({
            state: 'transferring',
            bytesTransferred: report.bytesReceived,
            totalBytes: report.totalBytes,
            percentage: report.percentage,
            speed: report.speed,
            activeChannels: activeChCount,
            estimatedTimeRemaining: Math.round(remaining),
        });

        this.activeChannels.set(activeChCount);
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Utilities
    // ═══════════════════════════════════════════════════════

    private terminateWorker(): void {
        if (this.worker) {
            this.worker.postMessage({ command: 'abort' });
            this.worker.terminate();
            this.worker = null;
        }
    }

    private formatSpeed(bytesPerSec: number): string {
        if (bytesPerSec >= 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
        if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
        if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
        return `${bytesPerSec} B/s`;
    }
}
