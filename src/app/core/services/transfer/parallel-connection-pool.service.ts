import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { ConnectionService } from './connection.service';
import { TRANSFER_CONFIG } from './transfer.config';
import { ChannelRange, ControlMessage, ParallelSignal } from './transfer.types';

/**
 * Manages multiple parallel PeerConnections for true parallelism.
 * Each PC has its own SCTP stack → no shared buffer bottleneck.
 */

export interface ParallelConnection {
    index: number;
    pc: RTCPeerConnection;
    dc: RTCDataChannel | null;
    range: ChannelRange;
    bytesSent: number;
    bytesReceived: number;
    status: 'pending' | 'connecting' | 'connected' | 'open' | 'done' | 'error';
    signalOut$: Subject<ParallelSignal>;
}

@Injectable({ providedIn: 'root' })
export class ParallelConnectionPoolService {
    readonly connections = signal<ParallelConnection[]>([]);
    readonly activeCount = signal(0);

    private controlMessageHandler: ((msg: ControlMessage) => void) | null = null;
    private dataMessageHandlers = new Map<number, (arrayBuffer: ArrayBuffer) => void>();
    private maxBufferedAmount = TRANSFER_CONFIG.MAX_BUFFER_WAN;
    private pendingCandidates = new Map<number, RTCIceCandidateInit[]>();

    constructor(private connectionService: ConnectionService) {
    }

    setMaxBufferedAmount(value: number): void {
        this.maxBufferedAmount = value;
    }

    // ═══════════════════════════════════════════════════════
    // SENDER: Create N parallel PeerConnections
    // ═══════════════════════════════════════════════════════

    createSenderConnections(
        fileSize: number,
        connectionCount: number
    ): ParallelConnection[] {
        // Close any existing connections before creating new ones
        this.closeAll();

        const ranges = this.assignRanges(fileSize, connectionCount);
        const conns: ParallelConnection[] = [];

        for (let i = 0; i < connectionCount; i++) {
            const signalOut$ = new Subject<ParallelSignal>();
            const pc = this.connectionService.createPeerConnection();

            // Create DataChannel (ordered only for ch0 = control)
            const dc = pc.createDataChannel(`bam-parallel-${i}`, {
                ordered: i === 0,
            });
            dc.binaryType = 'arraybuffer';

            const conn: ParallelConnection = {
                index: i,
                pc,
                dc,
                range: ranges[i],
                bytesSent: 0,
                bytesReceived: 0,
                status: 'pending',
                signalOut$,
            };

            // Setup ICE candidate trickle
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    signalOut$.next({
                        connectionIndex: i,
                        type: 'candidate',
                        candidate: event.candidate.toJSON(),
                    });
                }
            };

            pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'connected') {
                    conn.status = 'connected';
                    this.updateActiveCount();
                } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                    conn.status = 'error';
                    this.updateActiveCount();
                }
            };

            dc.onopen = () => {
                conn.status = 'open';
                this.updateActiveCount();
            };

            dc.onclose = () => {
                if (conn.status !== 'done') {
                    conn.status = 'error';
                }
                this.updateActiveCount();
            };

            dc.onerror = (err) => {
                console.error(`[PC${i}] DataChannel error:`, err);
                conn.status = 'error';
                this.updateActiveCount();
            };

            conns.push(conn);
        }

        this.connections.set(conns);
        return conns;
    }

    // ═══════════════════════════════════════════════════════
    // SENDER: Create offers for all PCs
    // ═══════════════════════════════════════════════════════

    async createOffers(): Promise<void> {
        const conns = this.connections();
        await Promise.all(
            conns.map(async (conn) => {
                const offer = await this.connectionService.createOffer(conn.pc);
                conn.signalOut$.next({
                    connectionIndex: conn.index,
                    type: 'offer',
                    offer,
                });
            })
        );
    }

    // ═══════════════════════════════════════════════════════
    // SENDER: Handle incoming signals (answers/candidates)
    // ═══════════════════════════════════════════════════════

    async handleSignalIn(signal: ParallelSignal): Promise<void> {
        const connIndex = signal.connectionIndex;
        const conn = this.connections().find((c) => c.index === connIndex);
        if (!conn) {
            console.warn(`[PARALLEL-POOL] Signal for unknown connection ${connIndex}`);
            return;
        }

        if (signal.type === 'answer' && signal.answer) {
            await this.connectionService.setRemoteAnswer(conn.pc, signal.answer);
            // Flush candidates that arrived before the answer
            const pending = this.pendingCandidates.get(connIndex) ?? [];
            for (const candidate of pending) {
                await this.connectionService.addIceCandidate(conn.pc, candidate);
            }
            this.pendingCandidates.delete(connIndex);
        } else if (signal.type === 'candidate' && signal.candidate) {
            if (this.connectionService.hasRemoteDescription(conn.pc)) {
                await this.connectionService.addIceCandidate(conn.pc, signal.candidate);
            } else {
                // Buffer candidate — answer not yet applied (trickle ICE race)
                const bucket = this.pendingCandidates.get(connIndex) ?? [];
                bucket.push(signal.candidate);
                this.pendingCandidates.set(connIndex, bucket);
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    // RECEIVER: Accept N parallel PeerConnections
    // ═══════════════════════════════════════════════════════

    acceptReceiverConnections(
        connectionCount: number,
        signalOut$: Subject<ParallelSignal>
    ): ParallelConnection[] {
        // Close any existing connections before creating new ones.
        // Note: closeAll() completes old signalOut$ Subjects — that's fine because
        // the new session passes a fresh Subject as the signalOut$ parameter.
        this.closeAll();

        const conns: ParallelConnection[] = [];

        for (let i = 0; i < connectionCount; i++) {
            const pc = this.connectionService.createPeerConnection();

            const conn: ParallelConnection = {
                index: i,
                pc,
                dc: null, // Will be set in ondatachannel
                range: { channelIndex: i, start: 0, end: 0 }, // Set from metadata
                bytesSent: 0,
                bytesReceived: 0,
                status: 'pending',
                signalOut$,
            };

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    signalOut$.next({
                        connectionIndex: i,
                        type: 'candidate',
                        candidate: event.candidate.toJSON(),
                    });
                }
            };

            pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'connected') {
                    conn.status = 'connected';
                    this.updateActiveCount();
                } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                    conn.status = 'error';
                    this.updateActiveCount();
                }
            };

            pc.ondatachannel = (event) => {
                const dc = event.channel;
                dc.binaryType = 'arraybuffer';
                conn.dc = dc;

                dc.onopen = () => {
                    conn.status = 'open';
                    this.updateActiveCount();
                };

                dc.onclose = () => {
                    if (conn.status !== 'done') {
                        conn.status = 'error';
                    }
                    this.updateActiveCount();
                };

                dc.onerror = (err) => {
                    console.error(`[PC${i}] DataChannel error:`, err);
                    conn.status = 'error';
                    this.updateActiveCount();
                };

                // Route messages
                dc.onmessage = (msgEvent) => {
                    const rawData = msgEvent.data;
                    if (typeof rawData === 'string') {
                        // Control message (only on conn0)
                        try {
                            const msg: ControlMessage = JSON.parse(rawData);
                            this.controlMessageHandler?.(msg);
                        } catch {
                            console.warn('[PARALLEL-POOL] Invalid control message');
                        }
                    } else if (rawData instanceof ArrayBuffer) {
                        const handler = this.dataMessageHandlers.get(i);
                        if (handler) {
                            handler(rawData);
                        }
                    }
                };
            };

            conns.push(conn);
        }

        this.connections.set(conns);
        return conns;
    }

    // ═══════════════════════════════════════════════════════
    // RECEIVER: Handle offers and create answers
    // ═══════════════════════════════════════════════════════

    async handleOfferAndCreateAnswer(signal: ParallelSignal): Promise<void> {
        const connIndex = signal.connectionIndex;
        const conn = this.connections().find((c) => c.index === connIndex);
        if (!conn) {
            console.warn(`[PARALLEL-POOL] Offer for unknown connection ${connIndex}`);
            return;
        }

        if (!signal.offer) {
            return;
        }
        const answer = await this.connectionService.createAnswer(conn.pc, signal.offer);
        conn.signalOut$.next({
            connectionIndex: connIndex,
            type: 'answer',
            answer,
        });
    }

    // ═══════════════════════════════════════════════════════
    // Wait for all connections to be ready
    // ═══════════════════════════════════════════════════════

    async waitForAllReady(timeoutMs = TRANSFER_CONFIG.CONNECTION_TIMEOUT): Promise<void> {
        const conns = this.connections();

        await Promise.all(
            conns.map(async (conn) => {
                await this.connectionService.waitForConnection(conn.pc);
                await this.connectionService.verifyStability(conn.pc);
            })
        );
    }

    async waitForAllChannelsOpen(timeoutMs = TRANSFER_CONFIG.CHANNEL_OPEN_TIMEOUT): Promise<void> {
        const deadline = Date.now() + timeoutMs;

        const checkReady = () => {
            const conns = this.connections();
            return conns.length > 0 && conns.every((c) => c.dc && c.dc.readyState === 'open');
        };

        while (!checkReady() && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        if (!checkReady()) {
            const statuses = this.connections()
                .map((c) => `PC${c.index}:${c.dc?.readyState ?? 'null'}`)
                .join(', ');
            throw new Error(`Timeout waiting for channels: ${statuses}`);
        }
    }

    // ═══════════════════════════════════════════════════════
    // Send control message (connection 0)
    // ═══════════════════════════════════════════════════════

    sendControl(msg: ControlMessage): void {
        const conn0 = this.connections()[0];
        if (!conn0 || !conn0.dc || conn0.dc.readyState !== 'open') {
            throw new Error('[PARALLEL-POOL] Control channel not ready');
        }
        conn0.dc.send(JSON.stringify(msg));
    }

    // ═══════════════════════════════════════════════════════
    // Send chunk with backpressure handling
    // ═══════════════════════════════════════════════════════

    async sendChunk(
        conn: ParallelConnection,
        wirePacket: ArrayBuffer,
        dataSize: number
    ): Promise<void> {
        if (!conn.dc || conn.dc.readyState !== 'open') {
            throw new Error(`[PC${conn.index}] DataChannel not open`);
        }

        // Wait for buffer drain if needed
        if (conn.dc.bufferedAmount > this.maxBufferedAmount) {
            await this.waitForBufferDrain(conn.dc);
        }

        // Re-check after drain
        if (!conn.dc || conn.dc.readyState !== 'open') {
            throw new Error(`[PC${conn.index}] DataChannel closed during drain`);
        }

        conn.dc.send(wirePacket);
        conn.bytesSent += dataSize;
    }

    // ═══════════════════════════════════════════════════════
    // Handlers
    // ═══════════════════════════════════════════════════════

    onControlMessage(handler: (msg: ControlMessage) => void): void {
        this.controlMessageHandler = handler;
    }

    onConnectionData(connIndex: number, handler: (arrayBuffer: ArrayBuffer) => void): void {
        this.dataMessageHandlers.set(connIndex, handler);
    }

    // ═══════════════════════════════════════════════════════
    // Wait for all buffers to drain
    // ═══════════════════════════════════════════════════════

    async waitForAllBuffersDrained(timeoutMs = 30_000): Promise<void> {
        const deadline = Date.now() + timeoutMs;

        const checkDrained = () => {
            return this.connections().every(
                (c) => !c.dc || c.dc.readyState !== 'open' || c.dc.bufferedAmount === 0
            );
        };

        while (!checkDrained() && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        if (!checkDrained()) {
            console.warn('[PARALLEL-POOL] Buffer drain timeout');
        }
    }

    // ═══════════════════════════════════════════════════════
    // Cleanup
    // ═══════════════════════════════════════════════════════

    closeAll(): void {
        for (const conn of this.connections()) {
            try {
                conn.dc?.close();
                this.connectionService.closePeerConnection(conn.pc);
                conn.signalOut$.complete();
            } catch {
            }
        }
        this.connections.set([]);
        this.activeCount.set(0);
        this.controlMessageHandler = null;
        this.dataMessageHandlers.clear();
        this.pendingCandidates.clear();
    }

    // ═══════════════════════════════════════════════════════
    // Public helpers
    // ═══════════════════════════════════════════════════════

    assignRanges(fileSize: number, count: number): ChannelRange[] {
        const rangeSize = Math.ceil(fileSize / count);
        return Array.from({ length: count }, (_, i) => ({
            channelIndex: i,
            start: i * rangeSize,
            end: Math.min((i + 1) * rangeSize, fileSize),
        }));
    }

    // ═══════════════════════════════════════════════════════
    // Private helpers
    // ═══════════════════════════════════════════════════════

    private async waitForBufferDrain(dc: RTCDataChannel): Promise<void> {
        return new Promise((resolve) => {
            dc.bufferedAmountLowThreshold = TRANSFER_CONFIG.LOW_WATER_MARK;

            const timeout = setTimeout(() => {
                dc.removeEventListener('bufferedamountlow', onDrain);
                resolve();
            }, TRANSFER_CONFIG.BACKPRESSURE_TIMEOUT);

            const onDrain = () => {
                clearTimeout(timeout);
                dc.removeEventListener('bufferedamountlow', onDrain);
                resolve();
            };

            dc.addEventListener('bufferedamountlow', onDrain);

            if (dc.bufferedAmount <= TRANSFER_CONFIG.LOW_WATER_MARK) {
                clearTimeout(timeout);
                dc.removeEventListener('bufferedamountlow', onDrain);
                resolve();
            }
        });
    }

    private updateActiveCount(): void {
        const count = this.connections().filter((c) => c.status === 'open').length;
        this.activeCount.set(count);
    }
}
