import { Injectable, signal } from '@angular/core';
import { FileShareSession } from '@core/services/signaling.service';
import { TransferMethod, RetentionPolicy, R2UploadProgress } from '@core/services/r2-transfer.types';

@Injectable({ providedIn: 'root' })
export class UploadStateService {
    // File
    readonly selectedFile = signal<File | null>(null);

    // Link generation
    readonly generatedLink = signal<string>('');
    readonly qrCodeUrl = signal<string | null>(null);
    readonly linkId = signal<string>('');
    readonly isGeneratingLink = signal(false);
    readonly linkCopied = signal(false);
    readonly hashProgress = signal(0);

    // Mode
    readonly mode = signal<'burn' | 'seed'>('burn');

    // Transfer method & retention (Cloud/P2P)
    readonly transferMethod = signal<TransferMethod>('cloud');
    readonly retentionPolicy = signal<RetentionPolicy>('3day');
    readonly isCloudUploading = signal(false);
    readonly cloudUploadProgress = signal<R2UploadProgress | null>(null);

    // Password (Premium)
    readonly password = signal('');
    readonly showPasswordInput = signal(false);

    // Custom slug (Premium)
    readonly customSlug = signal('');
    readonly showCustomSlug = signal(false);
    readonly customSlugError = signal('');

    // Transfer
    readonly isTransferring = signal(false);
    readonly isRetrying = signal(false);
    readonly session = signal<FileShareSession | null>(null);

    hasActiveSession(): boolean {
        return !!this.linkId() && !!this.selectedFile();
    }

    reset() {
        this.selectedFile.set(null);
        this.generatedLink.set('');
        this.qrCodeUrl.set(null);
        this.linkId.set('');
        this.linkCopied.set(false);
        this.hashProgress.set(0);
        this.password.set('');
        this.showPasswordInput.set(false);
        this.customSlug.set('');
        this.showCustomSlug.set(false);
        this.customSlugError.set('');
        this.isGeneratingLink.set(false);
        this.isTransferring.set(false);
        this.isRetrying.set(false);
        this.session.set(null);
        this.mode.set('burn');
        this.transferMethod.set('cloud');
        this.retentionPolicy.set('3day');
        this.isCloudUploading.set(false);
        this.cloudUploadProgress.set(null);
    }
}
