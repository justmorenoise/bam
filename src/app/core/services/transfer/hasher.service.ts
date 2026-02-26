import { Injectable, signal } from '@angular/core';
import { createXXHash128 } from 'hash-wasm';
import { TRANSFER_CONFIG } from './transfer.config';

@Injectable({ providedIn: 'root' })
export class HasherService {
    readonly hashProgress = signal(0);

    private worker: Worker | null = null;

    async calculateHash(file: File, onProgress?: (pct: number) => void): Promise<string> {
        this.hashProgress.set(0);

        if (file.size <= TRANSFER_CONFIG.HASH_SUBTLE_MAX) {
            return this.hashWithXXHash128(file, onProgress);
        }
        return this.hashWithWorker(file, onProgress);
    }

    async verifyHash(blob: Blob, expectedHash: string, onProgress?: (pct: number) => void): Promise<boolean> {
        const file = new File([blob], 'verify', { type: blob.type });
        const hash = await this.calculateHash(file, onProgress);
        return hash === expectedHash;
    }

    terminateWorker(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }

    // ─── xxHash128 main thread (< 100 MB) ──────────────────
    // Incremental streaming — no full-buffer allocation needed.

    private async hashWithXXHash128(file: File, onProgress?: (pct: number) => void): Promise<string> {
        const hasher = await createXXHash128();
        const reader = file.stream().getReader();
        let bytesRead = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            hasher.update(value);
            bytesRead += value.byteLength;
            const pct = (bytesRead / file.size) * 100;
            this.hashProgress.set(pct);
            onProgress?.(pct);
        }

        this.hashProgress.set(100);
        onProgress?.(100);
        return hasher.digest('hex');
    }

    // ─── hash-wasm Worker (≥ 100 MB) ───────────────────────

    private hashWithWorker(file: File, onProgress?: (pct: number) => void): Promise<string> {
        return new Promise((resolve, reject) => {
            this.terminateWorker();
            this.worker = new Worker(new URL('../../workers/hash-wasm.worker', import.meta.url), { type: 'module' });

            const chunkSize = TRANSFER_CONFIG.HASH_WORKER_CHUNK_SIZE;
            const totalChunks = Math.ceil(file.size / chunkSize);
            let chunkIndex = 0;

            this.worker.onmessage = async ({ data }) => {
                switch (data.type) {
                    case 'ready':
                        await this.sendNextHashChunk(file, chunkIndex++, chunkSize);
                        break;

                    case 'progress':
                        this.hashProgress.set(data.progress);
                        onProgress?.(data.progress);
                        if (chunkIndex < totalChunks) {
                            await this.sendNextHashChunk(file, chunkIndex++, chunkSize);
                        } else {
                            this.worker!.postMessage({ type: 'finalize' });
                        }
                        break;

                    case 'complete':
                        this.hashProgress.set(100);
                        onProgress?.(100);
                        resolve(data.hash);
                        break;

                    case 'error':
                        reject(new Error(data.error));
                        break;
                }
            };

            this.worker.onerror = (e) => reject(new Error(e.message));

            this.worker.postMessage({ type: 'init', totalChunks });
        });
    }

    private async sendNextHashChunk(file: File, index: number, chunkSize: number): Promise<void> {
        const start = index * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const slice = file.slice(start, end);
        const buffer = await slice.arrayBuffer();
        this.worker!.postMessage(
            { type: 'update', data: buffer, chunkIndex: index },
            [buffer]
        );
    }

}
