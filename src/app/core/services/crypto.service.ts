import { Injectable } from '@angular/core';
import { environment } from '@environments/environment';

export interface EncryptedData {
    ciphertext: ArrayBuffer;
    iv: Uint8Array;
    salt: Uint8Array;
}

interface HashWorkerMessage {
    type: 'init' | 'update' | 'finalize';
    data?: ArrayBuffer;
    chunkIndex?: number;
    totalChunks?: number;
}

@Injectable({
    providedIn: 'root'
})
export class CryptoService {
    private readonly ALGORITHM = environment.encryption.algorithm;
    private readonly KEY_LENGTH = environment.encryption.keyLength;
    private readonly IV_LENGTH = environment.encryption.ivLength;
    private readonly SALT_LENGTH = environment.encryption.saltLength;
    private readonly PBKDF2_ITERATIONS = environment.encryption.pbkdf2Iterations;

    constructor() {
        if (!window.crypto || !window.crypto.subtle) {
            throw new Error('Web Crypto API not supported in this browser');
        }
    }

    // Espone le impostazioni correnti PBKDF2
    getPbkdf2Iterations(): number {
        return this.PBKDF2_ITERATIONS;
    }

    // PASSWORD-BASED ENCRYPTION (Premium Feature)

    // Cache per chiavi derivate (evita ripetere PBKDF2 per ogni range)
    private derivedKeyCache = new Map<string, { key: CryptoKey; exportableKey: CryptoKey }>();

    /**
     * Deriva una chiave crittografica da una password usando PBKDF2
     */
    private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);

        // Import password as key material
        const keyMaterial = await window.crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        // Derive AES key
        return window.crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: this.PBKDF2_ITERATIONS,
                hash: 'SHA-256'
            },
            keyMaterial,
            {
                name: this.ALGORITHM,
                length: this.KEY_LENGTH
            },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Deriva una chiave esportabile (per inviarla ai Worker via postMessage).
     * Usa cache per evitare di ripetere PBKDF2 (100k iterazioni) per ogni range.
     */
    async deriveExportableKey(password: string, salt: Uint8Array): Promise<{
        key: CryptoKey;
        rawKey: ArrayBuffer;
        salt: Uint8Array;
    }> {
        const cacheKey = password + ':' + this.arrayBufferToBase64(salt.buffer);
        const cached = this.derivedKeyCache.get(cacheKey);

        if (cached) {
            const rawKey = await window.crypto.subtle.exportKey('raw', cached.exportableKey);
            return { key: cached.key, rawKey, salt };
        }

        const encoder = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        // Chiave non-esportabile per uso locale
        const key = await window.crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: this.PBKDF2_ITERATIONS, hash: 'SHA-256' },
            keyMaterial,
            { name: this.ALGORITHM, length: this.KEY_LENGTH },
            false,
            ['encrypt', 'decrypt']
        );

        // Chiave esportabile per i Worker
        const exportableKey = await window.crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: this.PBKDF2_ITERATIONS, hash: 'SHA-256' },
            keyMaterial,
            { name: this.ALGORITHM, length: this.KEY_LENGTH },
            true, // extractable
            ['encrypt', 'decrypt']
        );

        this.derivedKeyCache.set(cacheKey, { key, exportableKey });
        const rawKey = await window.crypto.subtle.exportKey('raw', exportableKey);
        return { key, rawKey, salt };
    }

    /**
     * Pulisce la cache delle chiavi derivate.
     */
    clearKeyCache(): void {
        this.derivedKeyCache.clear();
    }

    /**
     * Cifra dati usando AES-GCM con password
     */
    async encryptWithPassword(data: ArrayBuffer, password: string): Promise<EncryptedData> {
        // Generate random salt and IV
        const salt = window.crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
        const iv = window.crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));

        // Derive key from password
        const key = await this.deriveKey(password, salt);

        // Encrypt data
        const ciphertext = await window.crypto.subtle.encrypt(
            {
                name: this.ALGORITHM,
                iv: iv
            },
            key,
            data
        );

        return {
            ciphertext,
            iv,
            salt
        };
    }

    /**
     * Decifra dati usando AES-GCM con password
     */
    async decryptWithPassword(
        encryptedData: EncryptedData,
        password: string
    ): Promise<ArrayBuffer> {
        // Derive key from password and salt
        const key = await this.deriveKey(password, encryptedData.salt);

        // Decrypt data
        try {
            const decrypted = await window.crypto.subtle.decrypt(
                {
                    name: this.ALGORITHM,
                    iv: encryptedData.iv
                },
                key,
                encryptedData.ciphertext
            );

            return decrypted;
        } catch (error) {
            throw new Error('Decryption failed - wrong password or corrupted data');
        }
    }

    /**
     * Cifra un file in chunks per gestire file grandi
     */
    async encryptFileInChunks(
        file: File,
        password: string,
        chunkSize: number = 1024 * 1024, // 1MB chunks
        onProgress?: (progress: number) => void
    ): Promise<{
        chunks: EncryptedData[];
        originalName: string;
        originalSize: number;
        mimeType: string;
    }> {
        const chunks: EncryptedData[] = [];
        const totalChunks = Math.ceil(file.size / chunkSize);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end);
            const chunkBuffer = await chunk.arrayBuffer();

            const encryptedChunk = await this.encryptWithPassword(chunkBuffer, password);
            chunks.push(encryptedChunk);

            if (onProgress) {
                onProgress(((i + 1) / totalChunks) * 100);
            }
        }

        return {
            chunks,
            originalName: file.name,
            originalSize: file.size,
            mimeType: file.type
        };
    }

    /**
     * Decifra chunks e ricostruisce il file
     */
    async decryptFileFromChunks(
        chunks: EncryptedData[],
        password: string,
        onProgress?: (progress: number) => void
    ): Promise<ArrayBuffer> {
        const decryptedChunks: ArrayBuffer[] = [];

        for (let i = 0; i < chunks.length; i++) {
            const decrypted = await this.decryptWithPassword(chunks[i], password);
            decryptedChunks.push(decrypted);

            if (onProgress) {
                onProgress(((i + 1) / chunks.length) * 100);
            }
        }

        // Merge all chunks
        const totalLength = decryptedChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;

        for (const chunk of decryptedChunks) {
            result.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }

        return result.buffer;
    }

    // WEB WORKER SUPPORT
    private wasmHashWorker: Worker | null = null;

    /**
     * Inizializza il web worker WASM ottimizzato (CONSIGLIATO)
     */
    private getWasmHashWorker(): Worker {
        if (!this.wasmHashWorker) {
            this.wasmHashWorker = new Worker(new URL('../workers/hash-wasm.worker', import.meta.url), {
                type: 'module'
            });
        }
        return this.wasmHashWorker;
    }

    /**
     * Calcola hash usando Web Worker WASM (VELOCE + NON BLOCCA UI)
     * Usa WebAssembly per prestazioni native (5-10x più veloce di JS)
     * Hashing incrementale - NON accumula in memoria
     */
    async calculateFileHashWithWasmWorker(
        file: File | Blob,
        chunkSize: number = 2 * 1024 * 1024, // 2MB chunks
        onProgress?: (progress: number) => void
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const worker = this.getWasmHashWorker();
            const totalChunks = Math.ceil(file.size / chunkSize);
            let currentChunk = 0;

            // Handler messaggi dal worker
            const messageHandler = async (event: MessageEvent) => {
                const { type, progress, hash, error } = event.data;

                switch (type) {
                    case 'ready':
                        // Worker pronto, inizia a inviare chunk
                        await sendNextChunk();
                        break;

                    case 'progress':
                        if (onProgress) {
                            onProgress(progress);
                        }
                        // Continua con il prossimo chunk
                        if (currentChunk < totalChunks) {
                            await sendNextChunk();
                        } else {
                            // Tutti i chunk inviati, finalizza
                            worker.postMessage({ type: 'finalize' });
                        }
                        break;

                    case 'complete':
                        worker.removeEventListener('message', messageHandler);
                        resolve(hash);
                        break;

                    case 'error':
                        worker.removeEventListener('message', messageHandler);
                        reject(new Error(error || 'Hash calculation failed'));
                        break;
                }
            };

            // Funzione per inviare il prossimo chunk
            const sendNextChunk = async () => {
                if (currentChunk < totalChunks) {
                    const start = currentChunk * chunkSize;
                    const end = Math.min(start + chunkSize, file.size);
                    const chunk = file.slice(start, end);
                    const buffer = await chunk.arrayBuffer();

                    worker.postMessage({
                        type: 'update',
                        data: buffer,
                        chunkIndex: currentChunk,
                        totalChunks: totalChunks
                    } satisfies HashWorkerMessage, [buffer]); // Transferable object per evitare copia

                    currentChunk++;
                }
            };

            worker.addEventListener('message', messageHandler);

            // Inizializza worker
            worker.postMessage({
                type: 'init',
                totalChunks: totalChunks
            });
        });
    }

    /**
     * Termina i worker attivi (per pulizia)
     */
    terminateWorkers(): void {
        if (this.wasmHashWorker) {
            this.wasmHashWorker.terminate();
            this.wasmHashWorker = null;
        }
    }

    // FILE INTEGRITY (SHA-256 Hash)

    /**
     * Calcola l'hash SHA-256 di un file con selezione automatica del metodo ottimale
     *
     * SELEZIONE AUTOMATICA:
     * - File < 50MB: SubtleCrypto nativo (veloce, tutto in memoria)
     * - File 50MB - 1GB: CryptoJS incrementale nel main thread
     * - File > 1GB: Web Worker (non blocca UI)
     *
     * @param file File, Blob o ArrayBuffer da hashare
     * @param onProgress Callback opzionale per progress (solo file > 50MB)
     * @param forceWorker Forza l'uso del Web Worker anche per file piccoli
     */
    async calculateFileHash(
        file: File | Blob | ArrayBuffer,
        onProgress?: (progress: number) => void,
        forceWorker: boolean = false
    ): Promise<string> {
        // Gestione ArrayBuffer (sempre SubtleCrypto)
        if (!(file instanceof File || file instanceof Blob)) {
            console.log(`CryptoService.calculateFileHash - Gestione ArrayBuffer`);
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', file);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        const fileSizeMB = file.size / (1024 * 1024);

        // STRATEGIA 1: File < 1 GB - SubtleCrypto nativo
        if (fileSizeMB < 1000 && !forceWorker) {
            console.log(`CryptoService.calculateFileHash - STRATEGIA 1: File < 1 GB - SubtleCrypto nativo`);
            if (onProgress) onProgress(0);
            const buffer = await file.arrayBuffer();
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            if (onProgress) onProgress(100);
            return hashHex;
        }

        // STRATEGIA 2: File > 1 GB - WASM Worker (VELOCE + NON BLOCCA UI)
        console.log(`CryptoService.calculateFileHash - STRATEGIA 2: File > 1 GB - Wasm`);
        // return this.calculateFileHashWasm(file, 2 * 1024 * 1024, onProgress);
        // return this.calculateFileHashProgressive(file, 32 * 1024 * 1024, onProgress);
        // console.log(`CryptoService.calculateFileHash - STRATEGIA 2: File > 1 GB - WASM Worker (VELOCE + NON BLOCCA UI)`);
        return this.calculateFileHashWithWasmWorker(file, 2 * 1024 * 1024, onProgress);
    }

    /**
     * Verifica l'integrità di un file confrontando gli hash.
     * Usa automaticamente il metodo più adatto (Worker per file > 1GB).
     *
     * @param file File, Blob o ArrayBuffer da verificare
     * @param expectedHash Hash atteso in formato esadecimale
     * @param onProgress Callback opzionale per progress reporting
     * @returns true se l'hash corrisponde, false altrimenti
     */
    async verifyFileIntegrity(
        file: File | Blob | ArrayBuffer,
        expectedHash: string,
        onProgress?: (progress: number) => void
    ): Promise<boolean> {
        if (!expectedHash) return false;

        // Usa calculateFileHash con selezione automatica del metodo
        const actualHash = await this.calculateFileHash(file, onProgress);

        return actualHash.toLowerCase() === expectedHash.trim().toLowerCase();
    }

    // UTILITY METHODS

    /**
     * Genera un ID univoco per i link
     */
    generateLinkId(length: number = 12): string {
        const array = new Uint8Array(length);
        window.crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(36))
            .join('')
            .substring(0, length);
    }

    /**
     * Genera una password casuale sicura
     */
    generateSecurePassword(length: number = 16): string {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        const array = new Uint8Array(length);
        window.crypto.getRandomValues(array);
        return Array.from(array, byte => charset[byte % charset.length]).join('');
    }

    /**
     * Converte ArrayBuffer in Base64
     */
    arrayBufferToBase64(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Converte Base64 in ArrayBuffer
     */
    base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }
}
