import { Injectable } from '@angular/core';
import { environment } from '@environments/environment';

export interface EncryptedData {
    ciphertext: ArrayBuffer;
    iv: Uint8Array;
    salt: Uint8Array;
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
}
