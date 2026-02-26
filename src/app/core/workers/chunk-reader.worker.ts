/// <reference lib="webworker" />

/**
 * Chunk Reader Worker
 * Reads file ranges with independent parallel loops per channel.
 * Each channel reads and posts chunks autonomously — no round-robin blocking.
 * Optionally encrypts each chunk with AES-GCM.
 *
 * Output: wire-ready packets [8B header][payload] — the main thread sends
 * them directly to DataChannel without any additional copy.
 *
 * Header format (matches transfer.types.ts):
 *   [2B channelIndex Uint16BE][2B offsetHigh Uint16BE][4B offsetLow Uint32BE]
 *
 * Posts ArrayBuffer chunks as Transferable (zero-copy).
 */

interface ChannelRange {
    channelIndex: number;
    start: number;
    end: number;
}

interface StartCommand {
    command: 'start';
    file: File;
    ranges: ChannelRange[];
    chunkSize: number;
    encryptionKey?: ArrayBuffer;
    salt?: ArrayBuffer;
}

interface ControlCommand {
    command: 'pause' | 'resume' | 'abort';
}

type WorkerCommand = StartCommand | ControlCommand;

interface ChunkMessage {
    type: 'chunk';
    channelIndex: number;
    offset: number;
    /** Wire-ready packet: [8B header][payload]. dataSize = payload bytes only. */
    packet: ArrayBuffer;
    dataSize: number;
}

interface ChannelDoneMessage {
    type: 'channel-done';
    channelIndex: number;
}

interface DoneMessage {
    type: 'done';
}

interface ErrorMessage {
    type: 'error';
    message: string;
}

type WorkerMessage = ChunkMessage | ChannelDoneMessage | DoneMessage | ErrorMessage;

const AES_IV_LENGTH = 12;
const HEADER_SIZE = 8;

let paused = false;
let aborted = false;
let cryptoKey: CryptoKey | null = null;

addEventListener('message', async ({ data }: MessageEvent<WorkerCommand>) => {
    try {
        switch (data.command) {
            case 'start':
                await processFile(data);
                break;
            case 'pause':
                paused = true;
                break;
            case 'resume':
                paused = false;
                break;
            case 'abort':
                aborted = true;
                break;
        }
    } catch (err) {
        const msg: ErrorMessage = {
            type: 'error',
            message: err instanceof Error ? err.message : 'Unknown worker error',
        };
        postMessage(msg);
    }
});

async function processFile(cmd: StartCommand): Promise<void> {
    paused = false;
    aborted = false;
    cryptoKey = null;

    // Import encryption key if provided
    if (cmd.encryptionKey) {
        cryptoKey = await crypto.subtle.importKey(
            'raw',
            cmd.encryptionKey,
            { name: 'AES-GCM' },
            false,
            ['encrypt'],
        );
    }

    const { file, ranges, chunkSize } = cmd;

    // Each channel processes its range independently and in parallel.
    // No round-robin — all channels produce chunks concurrently.
    await Promise.all(
        ranges.map(range => processChannel(file, range, chunkSize))
    );

    if (!aborted) {
        const doneMsg: DoneMessage = { type: 'done' };
        postMessage(doneMsg);
    }
}

/**
 * Encodes the 8-byte wire header into the start of a packet buffer.
 * Format: [Uint16BE channelIndex][Uint16BE offsetHigh][Uint32BE offsetLow]
 */
function writeHeader(view: DataView, channelIndex: number, offset: number): void {
    view.setUint16(0, channelIndex, false);
    const high = Math.floor(offset / 0x100000000);
    const low = offset >>> 0;
    view.setUint16(2, high, false);
    view.setUint32(4, low, false);
}

/**
 * Processes a single channel's file range: reads chunks sequentially
 * from its slice of the file and posts them immediately.
 * Runs concurrently with all other channels via Promise.all.
 */
async function processChannel(
    file: File,
    range: ChannelRange,
    chunkSize: number,
): Promise<void> {
    const reader = file.slice(range.start, range.end).stream().getReader();
    let offset = range.start;

    // Residual buffer from previous read (when stream chunk doesn't align with our chunkSize)
    let residual: Uint8Array | null = null;
    let residualOffset = 0;

    try {
        while (!aborted) {
            // Wait while paused
            while (paused && !aborted) {
                await delay(10);
            }
            if (aborted) break;

            // ── Read enough data for one chunk ──────────────────
            let chunkLen = 0;
            let singlePart: Uint8Array | null = null; // fast-path for single-read case

            if (residual && (residual.byteLength - residualOffset) >= chunkSize) {
                // Residual alone has enough data
                singlePart = new Uint8Array(residual.buffer, residual.byteOffset + residualOffset, chunkSize);
                chunkLen = chunkSize;
                residualOffset += chunkSize;
                if (residualOffset >= residual.byteLength) {
                    residual = null;
                    residualOffset = 0;
                }
            } else {
                // Need to read from stream
                const parts: Uint8Array[] = [];

                // Include leftover from residual
                if (residual && residualOffset < residual.byteLength) {
                    const leftover = new Uint8Array(
                        residual.buffer,
                        residual.byteOffset + residualOffset,
                        residual.byteLength - residualOffset,
                    );
                    parts.push(leftover);
                    chunkLen = leftover.byteLength;
                    residual = null;
                    residualOffset = 0;
                }

                let streamDone = false;
                while (chunkLen < chunkSize) {
                    const result = await reader.read();
                    if (result.done) {
                        streamDone = true;
                        break;
                    }
                    parts.push(result.value);
                    chunkLen += result.value.byteLength;
                }

                if (chunkLen === 0 && streamDone) {
                    break; // Channel range fully read
                }

                if (parts.length === 1 && chunkLen <= chunkSize) {
                    singlePart = parts[0];
                } else if (parts.length === 1 && chunkLen > chunkSize) {
                    singlePart = parts[0].subarray(0, chunkSize);
                    residual = parts[0];
                    residualOffset = chunkSize;
                    chunkLen = chunkSize;
                } else {
                    // Multiple parts — combine
                    const combined = new Uint8Array(chunkLen);
                    let pos = 0;
                    for (const part of parts) {
                        combined.set(part, pos);
                        pos += part.byteLength;
                    }
                    if (chunkLen > chunkSize) {
                        singlePart = combined.subarray(0, chunkSize);
                        residual = combined;
                        residualOffset = chunkSize;
                        chunkLen = chunkSize;
                    } else {
                        singlePart = combined;
                    }
                }
            }

            const dataBytes = singlePart!;
            const payloadSize = chunkLen;

            // ── Encrypt if needed ────────────────────────────────
            let payloadForPacket: Uint8Array;

            if (cryptoKey) {
                const ivBytes = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
                const encrypted = await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv: ivBytes },
                    cryptoKey,
                    dataBytes,
                );
                // Encrypted packet: [header][IV][ciphertext]
                const encData = new Uint8Array(encrypted);
                const packet = new Uint8Array(HEADER_SIZE + AES_IV_LENGTH + encData.byteLength);
                const view = new DataView(packet.buffer);
                writeHeader(view, range.channelIndex, offset);
                packet.set(ivBytes, HEADER_SIZE);
                packet.set(encData, HEADER_SIZE + AES_IV_LENGTH);

                const msg: ChunkMessage = {
                    type: 'chunk',
                    channelIndex: range.channelIndex,
                    offset,
                    packet: packet.buffer,
                    dataSize: payloadSize,
                };
                postMessage(msg, [packet.buffer] as any);
            } else {
                // Unencrypted: build wire packet [header][data] — single allocation
                const packet = new Uint8Array(HEADER_SIZE + payloadSize);
                const view = new DataView(packet.buffer);
                writeHeader(view, range.channelIndex, offset);
                packet.set(dataBytes.byteLength === payloadSize
                    ? dataBytes
                    : dataBytes.subarray(0, payloadSize), HEADER_SIZE);

                const msg: ChunkMessage = {
                    type: 'chunk',
                    channelIndex: range.channelIndex,
                    offset,
                    packet: packet.buffer,
                    dataSize: payloadSize,
                };
                postMessage(msg, [packet.buffer] as any);
            }

            offset += payloadSize;
        }
    } finally {
        reader.releaseLock();
    }

    if (!aborted) {
        const doneMsg: ChannelDoneMessage = {
            type: 'channel-done',
            channelIndex: range.channelIndex,
        };
        postMessage(doneMsg);
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
