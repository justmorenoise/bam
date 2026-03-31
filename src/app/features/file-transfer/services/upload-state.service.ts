import { Injectable, signal } from '@angular/core';
import { FileShareSession } from '@core/services/signaling.service';
import { TransferMethod, RetentionPolicy, R2UploadProgress } from '@core/services/r2-transfer.types';
import { BurnProgress } from '@core/services/chunked-stream.types';

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

    // Transfer method: 'burn' (direct, streaming) | 'cloud' (premium, persistent)
    readonly transferMethod = signal<TransferMethod>('burn');
    readonly retentionPolicy = signal<RetentionPolicy>('burn');
    readonly cloudExpiryDays = signal<1 | 2 | 3>(3); // Cloud only: expiry in days (premium)

    // Burn transfer state
    readonly isBurnUploading = signal(false);
    readonly burnUploadProgress = signal<BurnProgress | null>(null);

    // Pending session resume (page refresh)
    readonly hasPendingBurnSession = signal(false);
    readonly pendingSessionFileName = signal<string>('');

    // Cloud transfer state
    readonly isCloudUploading = signal(false);
    readonly cloudUploadProgress = signal<R2UploadProgress | null>(null);

    // Custom slug (Premium)
    readonly customSlug = signal('');
    readonly showCustomSlug = signal(false);
    readonly customSlugError = signal('');

    // Password protection (cloud only, premium)
    readonly uploadPassword = signal<string>('');
    readonly showPasswordVisible = signal<boolean>(false);

    // Session
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
        this.customSlug.set('');
        this.showCustomSlug.set(false);
        this.customSlugError.set('');
        this.uploadPassword.set('');
        this.showPasswordVisible.set(false);
        this.isGeneratingLink.set(false);
        this.session.set(null);
        this.mode.set('burn');
        this.transferMethod.set('burn');
        this.retentionPolicy.set('burn');
        this.isBurnUploading.set(false);
        this.burnUploadProgress.set(null);
        this.isCloudUploading.set(false);
        this.cloudUploadProgress.set(null);
        this.hasPendingBurnSession.set(false);
        this.pendingSessionFileName.set('');
    }
}
