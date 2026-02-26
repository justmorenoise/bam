import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { createXXHash128 } from 'hash-wasm';
import { ConnectionService } from './connection.service';
import { ChannelPoolService } from './channel-pool.service';
import { ParallelConnection, ParallelConnectionPoolService } from './parallel-connection-pool.service';
import { TRANSFER_CONFIG } from './transfer.config';
import {
    CHUNK_HEADER_SIZE,
    ControlMessage,
    decodeChunkHeader,
    FileMetadata,
    ParallelSignal,
    ReceiverSession,
    TransferProgress,
    TransferState,
} from './transfer.types';

@Injectable({ providedIn: 'root' })
export class ReceiverEngineService {
    // ─── Public signals ────────────────────────────────────
    readonly state = signal<TransferState>('idle');
    readonly progress = signal<TransferProgress | null>(null);
    readonly activeChannels = signal(0);

    // ─── Private state ─────────────────────────────────────
    private pc: RTCPeerConnection | null = null;
    private password: string | undefined;

    // ─── Parallel mode state ───────────────────────────────
    private parallelConnections: ParallelConnection[] = [];
    private useParallelMode = false;
    private expectedConnections = 0;
    private receivedOffers = new Map<number, ParallelSignal>();

    // Receive buffer
    private metadata: FileMetadata | null = null;
    private receivedChunks = new Map<number, ArrayBuffer>();
    private bytesReceived = 0;
    private bytesReceivedPerChannel = new Map<number, number>();
    private chunksReceivedPerChannel = new Map<number, number>();
    private decryptionKey: CryptoKey | null = null;
    private transferCompleteReceived = false;
    private assembling = false;
    private transferStartTime = 0;

    // Reference to ch0 for sending ack-complete back
    private controlChannel: RTCDataChannel | null = null;

    // Speed calculation
    private lastSpeedTs = 0;
    private lastSpeedBytes = 0;
    private currentSpeed = 0;

    // Progress report throttle
    private lastProgressReportTs = 0;

    // File output subject (per-session)
    private fileOut$: Subject<{ blob: Blob; metadata: FileMetadata }> | null = null;

    constructor(
        private connection: ConnectionService,
        private channelPool: ChannelPoolService,
        private parallelPool: ParallelConnectionPoolService,
    ) {
    }

    // ═══════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════

    initReceiver(options?: { password?: string }): ReceiverSession {
        // Close any lingering connections from the previous session
        this.cleanup();
        this.useParallelMode = false;

        this.state.set('idle');
        this.progress.set(null);
        this.password = options?.password;

        // Reset receive buffer
        this.metadata = null;
        this.receivedChunks = new Map();
        this.bytesReceived = 0;
        this.bytesReceivedPerChannel = new Map();
        this.chunksReceivedPerChannel = new Map();
        this.decryptionKey = null;
        this.transferCompleteReceived = false;
        this.assembling = false;
        this.controlChannel = null;
        this.transferStartTime = 0;
        this.lastProgressReportTs = 0;
        this.resetSpeedTracking();

        const signalOut$ = new Subject<any>();
        this.fileOut$ = new Subject<{ blob: Blob; metadata: FileMetadata }>();
        const pendingCandidates: RTCIceCandidateInit[] = [];

        const signalIn = async (signal: any) => {
            try {
                // ── Detect parallel mode ──────────────────────────
                // Se il segnale ha connectionIndex, siamo in parallel mode
                if (signal.connectionIndex !== undefined) {
                    this.useParallelMode = true;
                    await this.handleParallelSignal(signal as ParallelSignal, signalOut$);
                    return;
                }

                // ── Legacy mode (identico al codice attuale) ──────
                if (!this.pc) {
                    if (signal.type === 'offer') {
                        await this.handleOffer(signal, signalOut$);
                        await this.flushPendingCandidates(pendingCandidates);
                    } else if (signal.candidate) {
                        pendingCandidates.push(signal);
                    }
                    return;
                }

                if (signal.candidate) {
                    await this.handleCandidate(signal);
                }
            } catch (err: any) {
                console.error('[RECEIVER] signalIn error:', err);
                this.state.set('error');
                this.fileOut$?.error(err);
            }
        };

        const cancel = () => {
            this.cleanup();
            this.fileOut$?.complete();
        };

        return {
            signalOut: signalOut$.asObservable(),
            signalIn,
            onFile: this.fileOut$.asObservable(),
            cancel,
        };
    }

    // ═══════════════════════════════════════════════════════
    // PARALLEL MODE
    // ═══════════════════════════════════════════════════════

    private async handleParallelSignal(
        signal: ParallelSignal,
        signalOut$: Subject<any>,
    ): Promise<void> {
        if (signal.type === 'offer') {
            const connIndex = signal.connectionIndex;

            // Prima offer (PC0) → inizializza con numero massimo di PC
            if (this.expectedConnections === 0) {
                this.state.set('connecting');

                // Crea il numero massimo di PC (4) - il sender poi ci dirà quante usare realmente
                const maxConnections = TRANSFER_CONFIG.PARALLEL_CONNECTIONS;
                this.expectedConnections = maxConnections;

                console.log(`[RECEIVER] Accepting up to ${maxConnections} parallel PeerConnections`);

                // Crea tutte le PC receiver
                this.parallelConnections = this.parallelPool.acceptReceiverConnections(
                    maxConnections,
                    signalOut$ as Subject<ParallelSignal>,
                );

                // Setup handlers
                this.setupParallelHandlers();
            }

            // Aggiungi questa offer alla mappa
            this.receivedOffers.set(connIndex, signal);

            // Handle questa offer
            await this.parallelPool.handleOfferAndCreateAnswer(signal);

            console.log(`[RECEIVER] Offer ${connIndex} processed (${this.receivedOffers.size}/${this.expectedConnections})`);

        } else if (signal.type === 'candidate') {
            // Routare ICE candidate alla PC corretta
            await this.parallelPool.handleSignalIn(signal);
        }
    }

    private setupParallelHandlers(): void {
        // Messaggi di controllo su DC0
        this.parallelPool.onControlMessage((msg) => {
            this.handleControlMessageParallel(msg);
        });

        // Dati binari su tutte le DC
        for (const conn of this.parallelConnections) {
            this.parallelPool.onConnectionData(conn.index, async (rawData: ArrayBuffer) => {
                await this.handleChunk(rawData);
            });
        }
    }

    private handleControlMessageParallel(msg: ControlMessage): void {
        switch (msg.type) {
            case 'metadata':
                this.handleMetadataParallel(msg.metadata);
                break;

            case 'transfer-complete':
                this.transferCompleteReceived = true;
                const pct = this.metadata?.size ? ((this.bytesReceived / this.metadata.size) * 100).toFixed(1) : '?';
                console.log(`[RECEIVER] transfer-complete received (${pct}% so far)`);
                // Force 100% progress report so the sender UI transitions immediately
                if (this.metadata) {
                    this.sendProgressReport(this.bytesReceived, this.metadata.size, 0, 100);
                }
                this.tryFinalize();
                break;

            case 'channel-done':
                break;

            case 'error':
                console.error(`[RECEIVER] sender error: ${msg.message}`);
                this.state.set('error');
                this.fileOut$?.error(new Error(msg.message));
                break;
        }
    }

    private handleMetadataParallel(metadata: FileMetadata): void {
        console.log(`[RECEIVER] metadata: ${metadata.name} (${this.formatSize(metadata.size)}, ${metadata.channelCount} PC)`);
        this.metadata = metadata;
        this.activeChannels.set(metadata.channelCount);
        this.resetSpeedTracking();
        this.lastSpeedTs = Date.now();
        this.transferStartTime = Date.now();

        // Chiudi le PC in eccesso se il sender ne usa meno del massimo
        const actualCount = metadata.channelCount;
        if (actualCount < this.expectedConnections) {
            console.log(`[RECEIVER] Closing ${this.expectedConnections - actualCount} unused PCs`);
            for (let i = actualCount; i < this.expectedConnections; i++) {
                const conn = this.parallelConnections[i];
                if (conn?.pc) {
                    conn.pc.close();
                }
            }
            this.parallelConnections = this.parallelConnections.slice(0, actualCount);
            this.parallelPool.connections.set(this.parallelConnections);
        }

        // Il control channel è DC0 del parallelPool
        const conn0 = this.parallelConnections[0];
        if (conn0?.dc && conn0.dc.readyState === 'open') {
            this.controlChannel = conn0.dc;
        }

        // ack-metadata via parallelPool
        this.parallelPool.sendControl({ type: 'ack-metadata' });

        this.state.set('transferring');
    }

    // ═══════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════

    cleanup(): void {
        if (this.useParallelMode) {
            this.cleanupParallel();
        } else {
            this.channelPool.closeAll();
            if (this.pc) {
                this.connection.closePeerConnection(this.pc);
                this.pc = null;
            }
        }

        this.metadata = null;
        this.receivedChunks = new Map();
        this.bytesReceived = 0;
        this.bytesReceivedPerChannel = new Map();
        this.chunksReceivedPerChannel = new Map();
        this.decryptionKey = null;
        this.transferCompleteReceived = false;
        this.assembling = false;
        this.controlChannel = null;
        this.transferStartTime = 0;
        this.resetSpeedTracking();
    }

    private cleanupParallel(): void {
        this.parallelPool.closeAll();
        this.parallelConnections = [];
        this.expectedConnections = 0;
        this.receivedOffers.clear();
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Signal handling
    // ═══════════════════════════════════════════════════════

    private async handleOffer(
        offer: RTCSessionDescriptionInit,
        signalOut$: Subject<any>,
    ): Promise<void> {
        this.state.set('connecting');
        this.pc = this.connection.createPeerConnection();

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                signalOut$.next(event.candidate.toJSON());
            }
        };

        // Setup channel acceptor BEFORE setting remote description
        this.setupChannelAcceptor(this.pc);

        const answer = await this.connection.createAnswer(this.pc, offer);
        signalOut$.next(answer);
    }

    private async handleCandidate(signal: any): Promise<void> {
        if (!this.pc) return;
        await this.connection.addIceCandidate(this.pc, signal);
    }

    private async flushPendingCandidates(pendingCandidates: RTCIceCandidateInit[]): Promise<void> {
        if (!this.pc || pendingCandidates.length === 0) return;
        for (const candidate of pendingCandidates) {
            await this.connection.addIceCandidate(this.pc, candidate);
        }
        pendingCandidates.length = 0;
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Channel acceptor (ondatachannel)
    // ═══════════════════════════════════════════════════════

    private setupChannelAcceptor(pc: RTCPeerConnection): void {
        pc.ondatachannel = (event) => {
            const dc = event.channel;
            dc.binaryType = 'arraybuffer';

            dc.onmessage = async (msgEvent) => {
                const rawData = msgEvent.data;

                if (typeof rawData === 'string') {
                    await this.handleControlMessage(rawData, dc);
                } else if (rawData instanceof ArrayBuffer && this.metadata) {
                    await this.handleChunk(rawData);
                }
            };

            dc.onerror = (err) => {
                console.error(`[RECEIVER] channel ${dc.label} error:`, err);
            };
        };
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Control message handling
    // ═══════════════════════════════════════════════════════

    private async handleControlMessage(rawData: string, dc: RTCDataChannel): Promise<void> {
        let msg: ControlMessage;
        try {
            msg = JSON.parse(rawData);
        } catch {
            return;
        }

        switch (msg.type) {
            case 'metadata':
                this.handleMetadata(msg.metadata, dc);
                break;

            case 'transfer-complete': {
                this.transferCompleteReceived = true;
                const pct = this.metadata?.size ? ((this.bytesReceived / this.metadata.size) * 100).toFixed(1) : '?';
                console.log(`[RECEIVER] transfer-complete received (${pct}% so far)`);
                // Force 100% progress report so the sender UI transitions immediately
                if (this.metadata) {
                    this.sendProgressReport(this.bytesReceived, this.metadata.size, 0, 100);
                }
                await this.tryFinalize();
                break;
            }

            case 'channel-done':
                break;

            case 'error':
                console.error(`[RECEIVER] sender error: ${msg.message}`);
                this.state.set('error');
                this.fileOut$?.error(new Error(msg.message));
                break;
        }
    }

    private handleMetadata(metadata: FileMetadata, dc: RTCDataChannel): void {
        console.log(`[RECEIVER] metadata: ${metadata.name} (${this.formatSize(metadata.size)}, ${metadata.channelCount}ch)`);
        this.metadata = metadata;
        this.controlChannel = dc;
        this.activeChannels.set(metadata.channelCount);
        this.resetSpeedTracking();
        this.lastSpeedTs = Date.now();
        this.transferStartTime = Date.now();

        if (dc.readyState === 'open') {
            dc.send(JSON.stringify({ type: 'ack-metadata' } satisfies ControlMessage));
        } else {
            console.error(`[RECEIVER] cannot send ack, dc.readyState: ${dc.readyState}`);
        }

        this.state.set('transferring');
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Chunk handling
    // ═══════════════════════════════════════════════════════

    private async handleChunk(rawData: ArrayBuffer): Promise<void> {
        if (!this.metadata) return;

        const { channelIndex, offset } = decodeChunkHeader(rawData);

        // Use subarray view to avoid copying the entire chunk.
        // For encrypted data or blob assembly we need the slice, but we defer it.
        let data: ArrayBuffer;

        if (this.metadata.encryption && this.password) {
            // Decrypt needs its own buffer — slice only the payload
            const payload = rawData.slice(CHUNK_HEADER_SIZE);
            if (!this.decryptionKey) {
                this.decryptionKey = await this.deriveDecryptionKey(
                    this.password,
                    this.metadata.encryption.saltB64,
                    this.metadata.encryption.iterations,
                );
            }
            data = await this.decryptChunk(payload, this.decryptionKey);
        } else {
            // No encryption — slice to get owned buffer for Blob assembly
            data = rawData.slice(CHUNK_HEADER_SIZE);
        }

        this.receivedChunks.set(offset, data);
        this.bytesReceived += data.byteLength;

        // Per-channel tracking
        this.bytesReceivedPerChannel.set(channelIndex, (this.bytesReceivedPerChannel.get(channelIndex) ?? 0) + data.byteLength);
        this.chunksReceivedPerChannel.set(channelIndex, (this.chunksReceivedPerChannel.get(channelIndex) ?? 0) + 1);

        this.updateProgress(this.bytesReceived, this.metadata.size);

        if (this.transferCompleteReceived) {
            await this.tryFinalize();
        }
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Transfer completion
    // ═══════════════════════════════════════════════════════

    private async tryFinalize(): Promise<void> {
        if (!this.metadata) return;
        if (!this.transferCompleteReceived) return;
        if (this.bytesReceived < this.metadata.size) return;
        if (this.assembling) return;

        this.assembling = true;

        // Log final stats
        const elapsed = (Date.now() - this.transferStartTime) / 1000;
        const avgSpeed = this.bytesReceived / elapsed;
        const chStats = Array.from(this.bytesReceivedPerChannel.entries())
            .sort(([a], [b]) => a - b)
            .map(([idx, bytes]) => {
                const chunks = this.chunksReceivedPerChannel.get(idx) ?? 0;
                return `ch${idx}:${(bytes / (1024 * 1024)).toFixed(1)}MB(${chunks})`;
            }).join(' ');
        console.log(`[RECEIVER] received ${(this.bytesReceived / (1024 * 1024)).toFixed(1)}MB in ${elapsed.toFixed(1)}s ` +
            `(avg ${this.formatSpeed(avgSpeed)}) | ${chStats}`);

        this.state.set('verifying');

        // Hash and assemble in one pass — no second read of the data.
        const hasher = await createXXHash128();
        const sortedOffsets = Array.from(this.receivedChunks.keys()).sort((a, b) => a - b);
        const parts: ArrayBuffer[] = [];
        for (const offset of sortedOffsets) {
            const chunk = this.receivedChunks.get(offset)!;
            hasher.update(new Uint8Array(chunk));
            parts.push(chunk);
        }
        const actualHash = hasher.digest('hex');
        const blob = new Blob(parts, { type: this.metadata.mimeType || 'application/octet-stream' });

        if (actualHash !== this.metadata.hash) {
            console.error('[RECEIVER] ✗ hash verification FAILED');
            this.sendAckComplete();
            this.state.set('error');
            this.fileOut$?.error(new Error('Hash verification failed'));
            return;
        }

        console.log('[RECEIVER] ✓ hash verified');
        this.sendAckComplete();

        this.state.set('completed');
        this.fileOut$?.next({ blob, metadata: this.metadata });
        this.fileOut$?.complete();
    }

    private sendAckComplete(): void {
        if (this.controlChannel && this.controlChannel.readyState === 'open') {
            this.controlChannel.send(JSON.stringify({ type: 'ack-complete' } satisfies ControlMessage));
        } else {
            console.warn(`[RECEIVER] cannot send ack-complete, channel: ${this.controlChannel?.readyState ?? 'null'}`);
        }
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Encryption
    // ═══════════════════════════════════════════════════════

    private async deriveDecryptionKey(password: string, saltB64: string, iterations: number): Promise<CryptoKey> {
        const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(password),
            'PBKDF2',
            false,
            ['deriveKey'],
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt'],
        );
    }

    private async decryptChunk(data: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
        const iv = data.slice(0, TRANSFER_CONFIG.AES_IV_LENGTH);
        const ciphertext = data.slice(TRANSFER_CONFIG.AES_IV_LENGTH);
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Progress
    // ═══════════════════════════════════════════════════════

    private updateProgress(bytesReceived: number, totalBytes: number): void {
        const now = Date.now();
        const elapsed = now - this.lastSpeedTs;

        if (elapsed > 500) {
            const bytesDelta = bytesReceived - this.lastSpeedBytes;
            const instantSpeed = (bytesDelta / elapsed) * 1000;
            this.currentSpeed = this.currentSpeed === 0
                ? instantSpeed
                : this.currentSpeed * (1 - TRANSFER_CONFIG.SPEED_EMA_ALPHA) + instantSpeed * TRANSFER_CONFIG.SPEED_EMA_ALPHA;
            this.lastSpeedTs = now;
            this.lastSpeedBytes = bytesReceived;
        }

        const percentage = totalBytes > 0 ? (bytesReceived / totalBytes) * 100 : 0;
        const remaining = this.currentSpeed > 0
            ? (totalBytes - bytesReceived) / this.currentSpeed
            : 0;

        const activeChCount = this.activeChannels();

        const roundedPercentage = Math.min(100, Math.round(percentage * 100) / 100);
        const roundedSpeed = Math.round(this.currentSpeed);

        this.progress.set({
            state: 'transferring',
            bytesTransferred: bytesReceived,
            totalBytes,
            percentage: roundedPercentage,
            speed: roundedSpeed,
            activeChannels: activeChCount,
            estimatedTimeRemaining: Math.round(remaining),
        });

        // Send progress report to sender via control channel (~every 500ms)
        if (now - this.lastProgressReportTs >= 500) {
            this.lastProgressReportTs = now;
            this.sendProgressReport(bytesReceived, totalBytes, roundedSpeed, roundedPercentage);
        }
    }

    private sendProgressReport(bytesReceived: number, totalBytes: number, speed: number, percentage: number): void {
        if (!this.controlChannel || this.controlChannel.readyState !== 'open') return;
        try {
            this.controlChannel.send(JSON.stringify({
                type: 'progress-report',
                bytesReceived,
                totalBytes,
                speed,
                percentage,
            } satisfies ControlMessage));
        } catch {
            // Non-critical — ignore send failures
        }
    }

    // ═══════════════════════════════════════════════════════
    // PRIVATE: Utilities
    // ═══════════════════════════════════════════════════════

    private resetSpeedTracking(): void {
        this.currentSpeed = 0;
        this.lastSpeedTs = 0;
        this.lastSpeedBytes = 0;
    }

    private formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    private formatSpeed(bytesPerSec: number): string {
        if (bytesPerSec >= 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
        if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
        if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
        return `${bytesPerSec} B/s`;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
