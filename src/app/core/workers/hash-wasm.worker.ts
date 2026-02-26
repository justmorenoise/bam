/// <reference lib="webworker" />

/**
 * Web Worker OTTIMIZZATO con hash-wasm
 * Usa WebAssembly per prestazioni native (5-10x più veloce)
 * Hashing incrementale + non blocca UI = PERFETTO!
 */

import { createXXHash128 } from 'hash-wasm';

interface HashWorkerMessage {
    type: 'init' | 'update' | 'finalize';
    data?: ArrayBuffer;
    chunkIndex?: number;
    totalChunks?: number;
}

interface HashWorkerResponse {
    type: 'ready' | 'progress' | 'complete' | 'error';
    progress?: number;
    hash?: string;
    error?: string;
}

let hasher: any = null;
let totalChunks = 0;
let processedChunks = 0;

addEventListener('message', async ({ data }: MessageEvent<HashWorkerMessage>) => {
    try {
        switch (data.type) {
            case 'init':
                // Inizializza hash WASM incrementale
                hasher = await createXXHash128();
                totalChunks = data.totalChunks || 0;
                processedChunks = 0;

                postMessage({ type: 'ready' } as HashWorkerResponse);
                break;

            case 'update':
                // Aggiorna hash con nuovo chunk (hashing incrementale WASM)
                if (data.data && hasher) {
                    // hash-wasm accetta Uint8Array
                    const chunk = new Uint8Array(data.data);
                    hasher.update(chunk);

                    processedChunks++;
                    const progress = totalChunks > 0
                        ? (processedChunks / totalChunks) * 100
                        : 0;

                    postMessage({
                        type: 'progress',
                        progress: Math.round(progress)
                    } as HashWorkerResponse);
                }
                break;

            case 'finalize':
                // Finalizza hash
                if (hasher) {
                    // digest() restituisce l'hash finale come stringa hex
                    const hashHex = hasher.digest('hex');

                    // Pulisci
                    hasher = null;
                    processedChunks = 0;
                    totalChunks = 0;

                    postMessage({
                        type: 'complete',
                        hash: hashHex,
                        progress: 100
                    } as HashWorkerResponse);
                } else {
                    throw new Error('Hash not initialized');
                }
                break;

            default:
                throw new Error(`Unknown message type: ${(data as any).type}`);
        }
    } catch (error) {
        postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
        } as HashWorkerResponse);
    }
});
