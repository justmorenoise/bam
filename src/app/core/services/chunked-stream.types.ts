export interface BurnChunkSignal {
    type: 'chunk-ready' | 'chunk-ack' | 'burn-complete' | 'hash-error' | 'sender-reconnected';
    from: 'sender' | 'receiver';
    chunkIndex?: number;
    totalChunks?: number;
    fileHash?: string;
    timestamp: number;
}

export interface BurnProgress {
    chunksTransferred: number;
    totalChunks: number;
    bytesTransferred: number;
    totalBytes: number;
    percentage: number;
    speedBps: number;
}

export type BurnState =
    | 'idle'
    | 'uploading'
    | 'downloading'
    | 'assembling'
    | 'verifying'
    | 'completed'
    | 'error';

export interface BurnSessionInfo {
    token: string;
    totalChunks: number;
    fileHash: string;
    fileName: string;
    fileSize: number;
    contentType: string;
}
