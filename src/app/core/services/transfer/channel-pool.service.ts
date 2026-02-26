import { Injectable, signal } from '@angular/core';
import { TRANSFER_CONFIG } from './transfer.config';
import { ChannelInfo, ChannelRange, CHUNK_HEADER_SIZE, ControlMessage, decodeChunkHeader, } from './transfer.types';

@Injectable({ providedIn: 'root' })
export class ChannelPoolService {
    readonly activeChannelCount = signal(0);
    readonly channels = signal<ChannelInfo[]>([]);

    private controlMessageHandler: ((msg: ControlMessage) => void) | null = null;
    private dataMessageHandlers = new Map<number, (data: ArrayBuffer) => void>();
    private maxBufferedAmount = TRANSFER_CONFIG.MAX_BUFFER_WAN;

    setMaxBufferedAmount(value: number): void {
        this.maxBufferedAmount = value;
    }

    // ─── Sender: create channels before SDP offer ───────────

    createSenderChannels(
        pc: RTCPeerConnection,
        count: number,
        ranges: ChannelRange[],
    ): ChannelInfo[] {
        const channelInfos: ChannelInfo[] = [];

        for (let i = 0; i < count; i++) {
            const label = `bam-data-${i}`;
            // Channel 0: ordered (control + data), others: unordered (data only)
            const dc = pc.createDataChannel(label, {
                ordered: i === 0,
                maxRetransmits: i === 0 ? undefined : undefined, // reliable by default
            });

            const info: ChannelInfo = {
                index: i,
                dc,
                range: ranges[i],
                bytesSent: 0,
                bytesReceived: 0,
                status: 'pending',
            };

            dc.binaryType = 'arraybuffer';

            dc.onopen = () => {
                info.status = 'open';
                this.updateActiveCount();
            };

            dc.onclose = () => {
                console.warn(`🧪 [CH-CLOSE] ch${i} closed (status: ${info.status}, readyState: ${dc.readyState})`);
                if (info.status !== 'done') {
                    info.status = 'error';
                }
                this.updateActiveCount();
            };

            dc.onerror = (event: any) => {
                console.error(`🧪 [CH-ERROR] ch${i} error:`, event);
                info.status = 'error';
                this.updateActiveCount();
            };

            channelInfos.push(info);
        }

        this.channels.set(channelInfos);
        return channelInfos;
    }

    // ─── Receiver: accept channels from ondatachannel ───────

    acceptReceiverChannels(
        pc: RTCPeerConnection,
        expectedCount: number,
    ): Promise<ChannelInfo[]> {
        return new Promise((resolve, reject) => {
            const channelInfos: ChannelInfo[] = [];
            const timeout = setTimeout(() => {
                pc.ondatachannel = null;
                reject(new Error(`Timeout waiting for ${expectedCount} channels, got ${channelInfos.length}`));
            }, TRANSFER_CONFIG.CHANNEL_OPEN_TIMEOUT);

            pc.ondatachannel = (event) => {
                const dc = event.channel;
                dc.binaryType = 'arraybuffer';

                // Extract index from label "bam-data-N"
                const match = dc.label.match(/bam-data-(\d+)/);
                const index = match ? parseInt(match[1], 10) : channelInfos.length;

                const info: ChannelInfo = {
                    index,
                    dc,
                    range: { channelIndex: index, start: 0, end: 0 }, // Will be set from metadata
                    bytesSent: 0,
                    bytesReceived: 0,
                    status: 'pending',
                };

                dc.onopen = () => {
                    info.status = 'open';
                    this.updateActiveCount();
                };

                dc.onclose = () => {
                    console.warn(`🧪 [CH-CLOSE] ch${index} closed (status: ${info.status}, readyState: ${dc.readyState})`);
                    if (info.status !== 'done') {
                        info.status = 'error';
                    }
                    this.updateActiveCount();
                };

                dc.onerror = (event: any) => {
                    console.error(`🧪 [CH-ERROR] ch${index} error:`, event);
                    info.status = 'error';
                    this.updateActiveCount();
                };

                // Route incoming messages
                dc.onmessage = (msgEvent) => {
                    const rawData = msgEvent.data;
                    if (typeof rawData === 'string') {
                        // JSON control message (only on channel 0)
                        try {
                            const msg: ControlMessage = JSON.parse(rawData);
                            this.controlMessageHandler?.(msg);
                        } catch {
                            console.warn('ChannelPool: invalid control message', rawData);
                        }
                    } else if (rawData instanceof ArrayBuffer) {
                        // Binary data chunk — route to handler
                        const handler = this.dataMessageHandlers.get(index);
                        if (handler) {
                            handler(rawData);
                        }
                    }
                };

                channelInfos.push(info);

                if (channelInfos.length === expectedCount) {
                    clearTimeout(timeout);
                    pc.ondatachannel = null;
                    // Sort by index
                    channelInfos.sort((a, b) => a.index - b.index);
                    this.channels.set(channelInfos);
                    resolve(channelInfos);
                }
            };
        });
    }

    // ─── Wait for all channels to open ──────────────────────

    waitForAllOpen(timeoutMs?: number): Promise<void> {
        const timeout = timeoutMs ?? TRANSFER_CONFIG.CHANNEL_OPEN_TIMEOUT;

        // Check using dc.readyState (the actual DataChannel state), not our custom status field
        const isReady = () => {
            const all = this.channels();
            return all.length > 0 && all.every(ch => ch.dc.readyState === 'open');
        };

        if (isReady()) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            let settled = false;

            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    clearInterval(interval);
                    const statuses = this.channels().map(ch => `${ch.index}:status=${ch.status},readyState=${ch.dc.readyState}`).join(', ');
                    reject(new Error(`Timeout waiting for channels to open [${statuses}]`));
                }
            }, timeout);

            const check = () => {
                if (settled) return;
                if (isReady()) {
                    settled = true;
                    clearTimeout(timer);
                    clearInterval(interval);
                    resolve();
                } else if (this.channels().some(ch => ch.dc.readyState === 'closed')) {
                    settled = true;
                    clearTimeout(timer);
                    clearInterval(interval);
                    reject(new Error('Channel closed during open'));
                }
            };

            const interval = setInterval(check, 50);
        });
    }

    // ─── Send control message (channel 0, JSON) ────────────

    sendControl(msg: ControlMessage): void {
        const allChannels = this.channels();
        const ch0 = allChannels[0];
        if (!ch0) {
            throw new Error('Control channel not found');
        }
        if (ch0.dc.readyState !== 'open') {
            throw new Error(`Control channel not open (readyState: ${ch0.dc.readyState})`);
        }
        ch0.dc.send(JSON.stringify(msg));
    }

    // ─── Send binary chunk with backpressure ────────────────

    /**
     * Sends a wire-ready packet directly to the DataChannel.
     * The packet already includes the 8B header — no copy needed.
     * @param channel Channel info
     * @param channelIndex Channel index (for error messages)
     * @param wirePacket Wire-ready ArrayBuffer: [8B header][payload]
     * @param dataSize Payload size in bytes (for bytesSent tracking)
     */
    async sendChunk(channel: ChannelInfo, channelIndex: number, wirePacket: ArrayBuffer, dataSize: number): Promise<void> {
        const dc = channel.dc;

        if (dc.readyState !== 'open') {
            throw new Error(`sendChunk: ch${channelIndex} not open (readyState: ${dc.readyState})`);
        }

        // 🧪 DIAGNOSTIC: Log when we hit backpressure
        const bufferedBefore = dc.bufferedAmount;

        // Wait for buffer to drain if needed
        if (dc.bufferedAmount > this.maxBufferedAmount) {
            const drainStart = performance.now();
            await this.waitForBufferDrain(dc);
            const drainTime = performance.now() - drainStart;

            // 🧪 DIAGNOSTIC: Log significant backpressure events
            if (drainTime > 100) { // Log only if waited >100ms
                console.log(
                    `🧪 [BP] ch${channelIndex} drained ${(bufferedBefore / (1024 * 1024)).toFixed(2)}MB → ` +
                    `${(dc.bufferedAmount / (1024 * 1024)).toFixed(2)}MB in ${drainTime.toFixed(0)}ms ` +
                    `(max: ${(this.maxBufferedAmount / (1024 * 1024)).toFixed(0)}MB, low: ${(TRANSFER_CONFIG.LOW_WATER_MARK / (1024 * 1024)).toFixed(0)}MB)`
                );
            }
        }

        // Re-check after drain wait — channel may have closed
        if (dc.readyState !== 'open') {
            throw new Error(`sendChunk: ch${channelIndex} closed during drain (readyState: ${dc.readyState})`);
        }

        // Send wire-ready packet directly — zero copy
        dc.send(wirePacket);
        channel.bytesSent += dataSize;
    }

    // ─── Register handlers ─────────────────────────────────

    onControlMessage(handler: (msg: ControlMessage) => void): void {
        this.controlMessageHandler = handler;
    }

    onChannelData(channelIndex: number, handler: (data: ArrayBuffer) => void): void {
        this.dataMessageHandlers.set(channelIndex, handler);
    }

    // ─── Parse incoming chunk ──────────────────────────────

    static parseChunk(raw: ArrayBuffer): { channelIndex: number; offset: number; data: ArrayBuffer } {
        const { channelIndex, offset } = decodeChunkHeader(raw);
        const data = raw.slice(CHUNK_HEADER_SIZE);
        return { channelIndex, offset, data };
    }

    // ─── Assign ranges ────────────────────────────────────

    static assignRanges(fileSize: number, channelCount: number): ChannelRange[] {
        const rangeSize = Math.ceil(fileSize / channelCount);
        return Array.from({ length: channelCount }, (_, i) => ({
            channelIndex: i,
            start: i * rangeSize,
            end: Math.min((i + 1) * rangeSize, fileSize),
        }));
    }

    // ─── Wait for all channel buffers to drain ────────────

    waitForAllBuffersDrained(timeoutMs = 30_000): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                clearInterval(interval);
                const remaining = this.channels()
                    .map(ch => `ch${ch.index}:${ch.dc.bufferedAmount}`)
                    .join(', ');
                console.warn(`[CHANNEL-POOL] buffer drain timeout, remaining: ${remaining}`);
                // Resolve anyway — the receiver's tryFinalize handles incomplete data
                resolve();
            }, timeoutMs);

            const check = () => {
                const allDrained = this.channels().every(
                    ch => ch.dc.readyState !== 'open' || ch.dc.bufferedAmount === 0
                );
                if (allDrained) {
                    clearTimeout(timer);
                    clearInterval(interval);
                    resolve();
                }
            };

            const interval = setInterval(check, 50);
            // Check immediately
            check();
        });
    }

    // ─── Cleanup ──────────────────────────────────────────

    closeAll(): void {
        for (const ch of this.channels()) {
            try {
                ch.dc.close();
            } catch { /* ignore */
            }
        }
        this.channels.set([]);
        this.activeChannelCount.set(0);
        this.controlMessageHandler = null;
        this.dataMessageHandlers.clear();
    }

    // ─── Private ──────────────────────────────────────────

    private waitForBufferDrain(dc: RTCDataChannel): Promise<void> {
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

            // Check if already drained
            if (dc.bufferedAmount <= TRANSFER_CONFIG.LOW_WATER_MARK) {
                clearTimeout(timeout);
                dc.removeEventListener('bufferedamountlow', onDrain);
                resolve();
            }
        });
    }

    private updateActiveCount(): void {
        const count = this.channels().filter(
            ch => ch.status === 'open' || ch.status === 'active'
        ).length;
        this.activeChannelCount.set(count);
    }
}
