import { Injectable, signal } from '@angular/core';
import { environment } from '@environments/environment';
import { SupabaseService } from './supabase.service';
import {
    R2TransferMeta,
    R2UploadProgress,
    R2MultipartCreateResponse,
    R2MultipartPart,
    RetentionPolicy,
} from './r2-transfer.types';

const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
const MULTIPART_PART_SIZE = 50 * 1024 * 1024;  // 50MB per part

@Injectable({ providedIn: 'root' })
export class R2TransferService {
    readonly uploadProgress = signal<R2UploadProgress | null>(null);
    readonly isUploading = signal(false);
    readonly downloadProgress = signal<R2UploadProgress | null>(null);
    readonly isDownloading = signal(false);

    private abortController: AbortController | null = null;
    private readonly baseUrl = environment.r2.workerUrl;

    constructor(private supabase: SupabaseService) {}

    // ─── Upload ──────────────────────────────────────────────

    async upload(
        file: File,
        retentionPolicy: RetentionPolicy,
        fileHash: string,
    ): Promise<R2TransferMeta> {
        this.abortController = new AbortController();
        this.isUploading.set(true);
        this.uploadProgress.set({ loaded: 0, total: file.size, percent: 0, speedBps: 0 });

        try {
            // 1. Create transfer
            const meta = await this.createTransfer(file, retentionPolicy, fileHash);

            // 2. Upload file (single or multipart)
            if (file.size >= MULTIPART_THRESHOLD) {
                await this.uploadMultipart(meta.token, file);
            } else {
                await this.uploadSingle(meta.token, file);
            }

            return meta;
        } finally {
            this.isUploading.set(false);
            this.abortController = null;
        }
    }

    private async createTransfer(
        file: File,
        retentionPolicy: RetentionPolicy,
        fileHash: string,
    ): Promise<R2TransferMeta> {
        const res = await fetch(`${this.baseUrl}/transfer`, {
            method: 'POST',
            headers: this.headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                fileName: file.name,
                fileSize: file.size,
                contentType: file.type || 'application/octet-stream',
                retentionPolicy,
                fileHash,
            }),
            signal: this.abortController?.signal,
        });

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Create transfer failed (${res.status}): ${body}`);
        }

        return res.json();
    }

    private uploadSingle(token: string, file: File): Promise<void> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const startTime = Date.now();

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const elapsed = (Date.now() - startTime) / 1000;
                    const speedBps = elapsed > 0 ? e.loaded / elapsed : 0;
                    this.uploadProgress.set({
                        loaded: e.loaded,
                        total: e.total,
                        percent: Math.round((e.loaded / e.total) * 100),
                        speedBps,
                    });
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve();
                } else {
                    reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
                }
            };

            xhr.onerror = () => reject(new Error('Upload network error'));
            xhr.onabort = () => reject(new Error('Upload aborted'));

            xhr.open('PUT', `${this.baseUrl}/transfer/${token}/upload`);
            for (const [key, value] of Object.entries(this.headers({ 'Content-Type': file.type || 'application/octet-stream' }))) {
                xhr.setRequestHeader(key, value);
            }
            xhr.send(file);

            // Wire up abort
            this.abortController?.signal.addEventListener('abort', () => xhr.abort());
        });
    }

    private async uploadMultipart(token: string, file: File): Promise<void> {
        const signal = this.abortController?.signal;
        const startTime = Date.now();

        // 1. Create multipart upload
        const createRes = await fetch(`${this.baseUrl}/transfer/${token}/multipart/create`, {
            method: 'POST',
            headers: this.headers(),
            signal,
        });
        if (!createRes.ok) throw new Error(`Multipart create failed (${createRes.status})`);
        const { uploadId } = (await createRes.json()) as R2MultipartCreateResponse;

        // 2. Upload parts
        const totalParts = Math.ceil(file.size / MULTIPART_PART_SIZE);
        const parts: R2MultipartPart[] = [];
        let totalUploaded = 0;

        for (let i = 0; i < totalParts; i++) {
            if (signal?.aborted) throw new Error('Upload aborted');

            const start = i * MULTIPART_PART_SIZE;
            const end = Math.min(start + MULTIPART_PART_SIZE, file.size);
            const partBlob = file.slice(start, end);
            const partNumber = i + 1;

            const partRes = await fetch(
                `${this.baseUrl}/transfer/${token}/multipart/${uploadId}/${partNumber}`,
                {
                    method: 'PUT',
                    headers: this.headers({ 'Content-Type': 'application/octet-stream' }),
                    body: partBlob,
                    signal,
                },
            );

            if (!partRes.ok) throw new Error(`Part ${partNumber} upload failed (${partRes.status})`);
            const { etag } = await partRes.json();
            parts.push({ partNumber, etag });

            totalUploaded += (end - start);
            const elapsed = (Date.now() - startTime) / 1000;
            this.uploadProgress.set({
                loaded: totalUploaded,
                total: file.size,
                percent: Math.round((totalUploaded / file.size) * 100),
                speedBps: elapsed > 0 ? totalUploaded / elapsed : 0,
            });
        }

        // 3. Complete multipart
        const completeRes = await fetch(`${this.baseUrl}/transfer/${token}/multipart/complete`, {
            method: 'POST',
            headers: this.headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ uploadId, parts }),
            signal,
        });
        if (!completeRes.ok) throw new Error(`Multipart complete failed (${completeRes.status})`);
    }

    // ─── Download ────────────────────────────────────────────

    async download(token: string, fileName: string): Promise<void> {
        this.isDownloading.set(true);
        this.downloadProgress.set({ loaded: 0, total: 0, percent: 0, speedBps: 0 });

        try {
            const res = await fetch(`${this.baseUrl}/transfer/${token}`, {
                headers: this.headers(),
            });

            if (!res.ok) {
                const body = await res.text();
                throw new Error(`Download failed (${res.status}): ${body}`);
            }

            const contentLength = parseInt(res.headers.get('Content-Length') || '0', 10);
            const reader = res.body?.getReader();
            if (!reader) throw new Error('No response body');

            const chunks: Uint8Array[] = [];
            let loaded = 0;
            const startTime = Date.now();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                loaded += value.byteLength;

                const elapsed = (Date.now() - startTime) / 1000;
                this.downloadProgress.set({
                    loaded,
                    total: contentLength,
                    percent: contentLength > 0 ? Math.round((loaded / contentLength) * 100) : 0,
                    speedBps: elapsed > 0 ? loaded / elapsed : 0,
                });
            }

            // Trigger browser download
            const blob = new Blob(chunks);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } finally {
            this.isDownloading.set(false);
        }
    }

    // ─── Status & Delete ─────────────────────────────────────

    async checkStatus(token: string): Promise<R2TransferMeta | null> {
        const res = await fetch(`${this.baseUrl}/transfer/${token}/status`, {
            headers: this.headers(),
        });

        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`Status check failed (${res.status})`);
        return res.json();
    }

    async deleteFile(token: string): Promise<void> {
        const res = await fetch(`${this.baseUrl}/transfer/${token}`, {
            method: 'DELETE',
            headers: this.headers(),
        });
        if (!res.ok && res.status !== 404) {
            throw new Error(`Delete failed (${res.status})`);
        }
    }

    // ─── Abort ───────────────────────────────────────────────

    abort(): void {
        this.abortController?.abort();
        this.abortController = null;
        this.isUploading.set(false);
        this.uploadProgress.set(null);
    }

    // ─── Helpers ─────────────────────────────────────────────

    getMaxCloudFileSize(): number {
        return this.supabase.isPremium()
            ? environment.limits.premium.maxCloudFileSize
            : environment.limits.free.maxCloudFileSize;
    }

    /** Ritorna il limite max per il burn upload (null = illimitato) */
    getMaxFileSize(): number | null {
        return this.supabase.isPremium()
            ? environment.limits.premium.maxFileSize
            : environment.limits.free.maxFileSize;
    }

    private headers(extra: Record<string, string> = {}): Record<string, string> {
        return {
            'X-Bam-Api-Key': environment.r2.apiKey,
            'X-Bam-Tier': this.supabase.isPremium() ? 'premium' : 'free',
            ...extra,
        };
    }
}
