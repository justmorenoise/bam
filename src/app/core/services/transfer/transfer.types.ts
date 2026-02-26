// ─── Connection ─────────────────────────────────────────────

export type ConnectionType = 'lan' | 'wan' | 'relay' | 'unknown';

export interface ConnectionProfile {
    type: ConnectionType;
    rttMs: number;
    availableBitrate: number;
    localCandidateType: string;
    remoteCandidateType: string;
}

export interface AdaptiveParams {
    chunkSize: number;
    maxBufferedAmount: number;
    channelCount: number;
    connectionProfile: ConnectionProfile;
}

// ─── Transfer ───────────────────────────────────────────────

export type TransferRole = 'sender' | 'receiver';

export type TransferState =
    | 'idle'
    | 'hashing'
    | 'connecting'
    | 'stabilizing'
    | 'transferring'
    | 'verifying'
    | 'completed'
    | 'error';

export interface TransferProgress {
    state: TransferState;
    bytesTransferred: number;
    totalBytes: number;
    percentage: number;
    speed: number;
    activeChannels: number;
    estimatedTimeRemaining: number;
}

export interface FileMetadata {
    name: string;
    size: number;
    mimeType: string;
    hash: string;
    channelCount: number;
    ranges: ChannelRange[];
    encryption?: EncryptionMetadata;
}

export interface EncryptionMetadata {
    algo: 'AES-GCM';
    saltB64: string;
    iterations: number;
}

export interface ChannelRange {
    channelIndex: number;
    start: number;
    end: number;
}

// ─── Chunk Wire Format ──────────────────────────────────────

// Binary header: [2B channelIndex Uint16BE][6B offset BE][data]
// Total header: 8 bytes — supports files up to 256 TB
// For encrypted chunks, data = [12B IV][ciphertext + 16B auth tag]

export const CHUNK_HEADER_SIZE = 8;

export function encodeChunkHeader(channelIndex: number, offset: number): ArrayBuffer {
    const header = new ArrayBuffer(CHUNK_HEADER_SIZE);
    const view = new DataView(header);
    view.setUint16(0, channelIndex, false);
    // 6-byte offset (big-endian): split into high 2 bytes + low 4 bytes
    const high = Math.floor(offset / 0x100000000);
    const low = offset >>> 0;
    view.setUint16(2, high, false);
    view.setUint32(4, low, false);
    return header;
}

export function decodeChunkHeader(buffer: ArrayBuffer): { channelIndex: number; offset: number } {
    const view = new DataView(buffer, 0, CHUNK_HEADER_SIZE);
    const channelIndex = view.getUint16(0, false);
    const high = view.getUint16(2, false);
    const low = view.getUint32(4, false);
    const offset = high * 0x100000000 + low;
    return { channelIndex, offset };
}

// ─── Control Messages ───────────────────────────────────────

export type ControlMessage =
    | { type: 'metadata'; metadata: FileMetadata }
    | { type: 'ack-metadata' }
    | { type: 'transfer-start' }
    | { type: 'transfer-complete'; totalBytesSent: number }
    | { type: 'ack-complete' }
    | { type: 'channel-done'; channelIndex: number; bytesSent: number }
    | { type: 'progress-report'; bytesReceived: number; totalBytes: number; speed: number; percentage: number }
    | { type: 'error'; message: string };

// ─── Channel Info ───────────────────────────────────────────

export type ChannelStatus = 'pending' | 'open' | 'active' | 'done' | 'error';

export interface ChannelInfo {
    index: number;
    dc: RTCDataChannel;
    range: ChannelRange;
    bytesSent: number;
    bytesReceived: number;
    status: ChannelStatus;
}

// ─── Worker Messages ────────────────────────────────────────

export type ChunkReaderCommand =
    | {
    command: 'start';
    file: File;
    ranges: ChannelRange[];
    chunkSize: number;
    encryptionKey?: ArrayBuffer;
    salt?: ArrayBuffer
}
    | { command: 'pause' }
    | { command: 'resume' }
    | { command: 'abort' };

export type ChunkReaderMessage =
    | { type: 'chunk'; channelIndex: number; offset: number; packet: ArrayBuffer; dataSize: number }
    | { type: 'channel-done'; channelIndex: number }
    | { type: 'done' }
    | { type: 'error'; message: string };

// ─── Session Types ──────────────────────────────────────────

export type ConnectionStatus =
    | 'waiting'
    | 'connecting'
    | 'connected'
    | 'stabilizing'
    | 'transferring'
    | 'completed'
    | 'disconnected'
    | 'retry-waiting'
    | 'error';

export interface SenderSession {
    signalOut: import('rxjs').Observable<any>;
    signalIn: (signal: any) => void;
    startTransfer: () => Promise<void>;
    cancel: () => void;
}

export interface ReceiverSession {
    signalOut: import('rxjs').Observable<any>;
    signalIn: (signal: any) => void;
    onFile: import('rxjs').Observable<{ blob: Blob; metadata: FileMetadata }>;
    cancel: () => void;
}

// ─── Parallel Connections ───────────────────────────────────

export interface ParallelSignal {
    connectionIndex: number;
    totalConnections?: number;  // Included in first offer to inform receiver
    type: 'offer' | 'answer' | 'candidate';
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
}
