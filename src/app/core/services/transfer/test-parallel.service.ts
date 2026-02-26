import { Injectable, signal } from '@angular/core';
import { merge, Subject } from 'rxjs';
import { ParallelConnection, ParallelConnectionPoolService } from './parallel-connection-pool.service';
import { TRANSFER_CONFIG } from './transfer.config';
import { ControlMessage, FileMetadata, TransferState } from './transfer.types';

/**
 * 🧪 TEST SERVICE - 3 Parallel PeerConnections
 * Minimal implementation to test throughput improvement
 */
@Injectable({ providedIn: 'root' })
export class TestParallelService {
    readonly state = signal<TransferState>('idle');

    private connections: ParallelConnection[] = [];
    private worker: Worker | null = null;
    private cancelled = false;

    constructor(private pool: ParallelConnectionPoolService) {
    }

    async testSend(file: File, fileHash: string, signalOut$: Subject<any>) {
        try {
            this.cancelled = false;
            this.state.set('connecting');

            // 1. Create 3 parallel PeerConnections
            const connectionCount = TRANSFER_CONFIG.PARALLEL_CONNECTIONS;
            this.connections = this.pool.createSenderConnections(file.size, connectionCount);

            // 2. Merge all signalOut streams into one
            const allSignals$ = merge(...this.connections.map(conn => conn.signalOut$));
            allSignals$.subscribe(signal => {
                console.log(`[TEST-3PC] Signal from PC${signal.connectionIndex}:`, signal.type);
                signalOut$.next(signal);
            });

            // 3. Create offers for all PCs
            await this.pool.createOffers();
            console.log(`[TEST-3PC] Created ${connectionCount} offers`);

            // 4. Wait for all PCs to connect
            await this.waitForAllConnected();
            console.log('[TEST-3PC] All PCs connected!');
            this.state.set('transferring');

            // 5. Send metadata on PC0
            const metadata: FileMetadata = {
                name: file.name,
                size: file.size,
                mimeType: file.type,
                hash: fileHash,
                channelCount: connectionCount,
                ranges: this.connections.map(c => c.range),
            };
            await this.sendControlMessage({ type: 'metadata', metadata });

            // 6. Start worker to read file chunks
            await this.startWorker(file);

            // 7. Wait for transfer complete
            this.state.set('completed');
            console.log('[TEST-3PC] Transfer completed!');

        } catch (err: any) {
            console.error('[TEST-3PC] Error:', err);
            this.state.set('error');
            throw err;
        }
    }

    handleSignalIn(signal: any) {
        // Route signal to correct PC
        this.pool.handleSignalIn(signal);
    }

    private async waitForAllConnected(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 30000);

            const check = () => {
                const allConnected = this.connections.every(c => c.status === 'open');
                if (allConnected) {
                    clearTimeout(timeout);
                    clearInterval(interval);
                    resolve();
                }
            };

            const interval = setInterval(check, 100);
            check();
        });
    }

    private async sendControlMessage(msg: ControlMessage): Promise<void> {
        const conn0 = this.connections[0];
        if (!conn0?.dc || conn0.dc.readyState !== 'open') {
            throw new Error('Control channel not open');
        }

        const json = JSON.stringify(msg);
        conn0.dc.send(json);
        console.log('[TEST-3PC] Sent control message:', msg.type);
    }

    private async startWorker(file: File): Promise<void> {
        return new Promise((resolve, reject) => {
            this.worker = new Worker(
                new URL('../../workers/chunk-reader.worker', import.meta.url),
                { type: 'module' }
            );

            const ranges = this.connections.map(c => c.range);
            const chunkSize = TRANSFER_CONFIG.CHUNK_SIZE_DEFAULT;

            this.worker.postMessage({
                command: 'start',
                file,
                ranges,
                chunkSize,
            });

            let chunksReceived = 0;
            let chunksSent = 0;
            const startTime = Date.now();

            this.worker.onmessage = async (event) => {
                const msg = event.data;

                if (msg.type === 'chunk') {
                    chunksReceived++;

                    // Send chunk to correct PC
                    const conn = this.connections.find(c => c.index === msg.channelIndex);
                    if (conn?.dc && conn.dc.readyState === 'open') {
                        // Wait for buffer if needed
                        while (conn.dc.bufferedAmount > 12 * 1024 * 1024) {
                            await this.delay(10);
                        }

                        conn.dc.send(msg.packet);
                        conn.bytesSent += msg.dataSize;
                        chunksSent++;

                        // Log progress every 100 chunks
                        if (chunksSent % 100 === 0) {
                            const elapsed = (Date.now() - startTime) / 1000;
                            const totalSent = this.connections.reduce((sum, c) => sum + c.bytesSent, 0);
                            const mbps = (totalSent / (1024 * 1024)) / elapsed;
                            console.log(
                                `[TEST-3PC] Sent ${chunksSent} chunks | ` +
                                `${totalSent / (1024 * 1024)} MB | ` +
                                `${mbps.toFixed(2)} MB/s | ` +
                                `PC0: ${(conn.bytesSent / (1024 * 1024)).toFixed(1)}MB ` +
                                `PC1: ${(this.connections[1].bytesSent / (1024 * 1024)).toFixed(1)}MB ` +
                                `PC2: ${(this.connections[2].bytesSent / (1024 * 1024)).toFixed(1)}MB`
                            );
                        }
                    }
                } else if (msg.type === 'channel-done') {
                    console.log(`[TEST-3PC] PC${msg.channelIndex} done`);
                } else if (msg.type === 'done') {
                    console.log('[TEST-3PC] All chunks sent');
                    const elapsed = (Date.now() - startTime) / 1000;
                    const totalSent = this.connections.reduce((sum, c) => sum + c.bytesSent, 0);
                    const mbps = (totalSent / (1024 * 1024)) / elapsed;
                    console.log(
                        `[TEST-3PC] 🎉 TOTAL: ${(totalSent / (1024 * 1024)).toFixed(1)} MB in ${elapsed.toFixed(1)}s ` +
                        `= ${mbps.toFixed(2)} MB/s`
                    );
                    resolve();
                } else if (msg.type === 'error') {
                    reject(new Error(msg.message));
                }
            };

            this.worker.onerror = (err) => reject(err);
        });
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    cleanup() {
        this.cancelled = true;
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.pool.closeAll();
        this.connections = [];
    }
}
