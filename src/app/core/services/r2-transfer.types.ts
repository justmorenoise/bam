export type RetentionPolicy = 'burn' | '3day' | 'permanent';
export type TransferMethod = 'cloud' | 'p2p';

export interface R2TransferMeta {
    token: string;
    fileName: string;
    fileSize: number;
    contentType: string;
    retentionPolicy: RetentionPolicy;
    expiresAt: number | null;
    createdAt: number;
}

export interface R2UploadProgress {
    loaded: number;
    total: number;
    percent: number;
    speedBps: number;
}

export interface R2MultipartCreateResponse {
    uploadId: string;
}

export interface R2MultipartPart {
    partNumber: number;
    etag: string;
}
