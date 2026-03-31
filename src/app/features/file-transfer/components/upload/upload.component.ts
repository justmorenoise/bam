import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '@shared/components/header.component';
import { PendingBurnSession, SignalingService } from '@core/services/signaling.service';
import { SupabaseService } from '@core/services/supabase.service';
import { ModalService } from '@core/services/modal.service';
import { R2TransferService } from '@core/services/r2-transfer.service';
import { HnNewsComponent } from '@shared/components/hn-news/hn-news.component';
import { HasherService } from '@core/services/transfer/hasher.service';
import { CryptoService } from '@core/services/crypto.service';
import { UploadStateService } from '../../services/upload-state.service';
import { Subscription } from 'rxjs';
import * as QRCode from 'qrcode';
import { DropZoneComponent } from './drop-zone/drop-zone.component';
import { AdBannerComponent } from '@shared/components/ad-banner.component';
import { AnalyticsService } from '@core/services/analytics.service';

@Component({
    selector: 'app-upload',
    standalone: true,
    imports: [CommonModule, FormsModule, HeaderComponent, RouterLink, DropZoneComponent, TranslateModule, AdBannerComponent, HnNewsComponent],
    templateUrl: './upload.component.html',
    styleUrls: ['./upload.component.css']
})
export class UploadComponent implements OnInit, OnDestroy {
    readonly st: UploadStateService;

    // ─── Template aliases ────────────────────────────────────────

    get selectedFile() { return this.st.selectedFile; }
    get generatedLink() { return this.st.generatedLink; }
    get qrCodeUrl() { return this.st.qrCodeUrl; }
    get isGeneratingLink() { return this.st.isGeneratingLink; }
    get linkCopied() { return this.st.linkCopied; }
    get hashProgress() { return this.st.hashProgress; }
    get mode() { return this.st.mode; }
    get customSlug() { return this.st.customSlug; }
    get showCustomSlug() { return this.st.showCustomSlug; }
    get customSlugError() { return this.st.customSlugError; }
    get uploadPassword() { return this.st.uploadPassword; }
    get showPasswordVisible() { return this.st.showPasswordVisible; }
    togglePasswordVisible() { this.st.showPasswordVisible.update(v => !v); }
    get session() { return this.st.session; }
    get transferMethod() { return this.st.transferMethod; }
    get retentionPolicy() { return this.st.retentionPolicy; }
    get cloudExpiryDays() { return this.st.cloudExpiryDays; }
    get isBurnUploading() { return this.st.isBurnUploading; }
    get burnUploadProgress() { return this.st.burnUploadProgress; }
    get isCloudUploading() { return this.st.isCloudUploading; }
    get cloudUploadProgress() { return this.st.cloudUploadProgress; }

    userProfile = this.supabase.currentProfile;

    private sessionSub?: Subscription;
    private cloudProgressInterval: ReturnType<typeof setInterval> | null = null;
    private burnProgressInterval: ReturnType<typeof setInterval> | null = null;
    private transferStartTs = 0;

    constructor(
        uploadState: UploadStateService,
        protected signaling: SignalingService,
        private supabase: SupabaseService,
        private modal: ModalService,
        private router: Router,
        private translate: TranslateService,
        private r2: R2TransferService,
        private hasher: HasherService,
        private crypto: CryptoService,
        private analytics: AnalyticsService,
    ) {
        this.st = uploadState;
    }

    ngOnInit() {
        // Check for pending burn session from page refresh
        const pending = this.signaling.getPendingSession();
        if (pending) {
            this.st.linkId.set(pending.linkId);
            this.st.generatedLink.set(pending.generatedLink);
            this.st.hasPendingBurnSession.set(true);
            this.st.pendingSessionFileName.set(pending.fileName);
            return;
        }

        if (this.st.hasActiveSession()) {
            this.reattachSessionSubscription();
        } else {
            const file = history.state?.file;
            if (file instanceof File) {
                this.st.selectedFile.set(file);
            }
        }
    }

    ngOnDestroy() {
        this.sessionSub?.unsubscribe();
        this.clearCloudProgressInterval();
        this.clearBurnProgressInterval();

        if (this.st.transferMethod() === 'cloud') {
            if (this.st.isCloudUploading()) {
                this.r2.abort();
                this.st.isCloudUploading.set(false);
                this.st.isGeneratingLink.set(false);
            }
        } else {
            const isActive = this.st.isBurnUploading();
            const hasLink = !!this.st.generatedLink();

            if (!isActive && !hasLink) {
                // No active transfer and no link generated — safe to tear down completely
                if (this.st.linkId()) {
                    this.signaling.closeSession(this.st.linkId());
                }
                this.signaling.terminateWorkers();
                this.st.reset();
            }
            // If link generated or transfer active: keep session alive for re-attach/resume.
            // sessionStorage persists the session info for page-refresh scenario.
        }
    }

    private reattachSessionSubscription() {
        const linkId = this.st.linkId();
        this.sessionSub?.unsubscribe();
        this.sessionSub = this.signaling.getSessionUpdates$().subscribe(updatedSession => {
            if (updatedSession.linkId === linkId) {
                this.st.session.set(updatedSession);
                this.handleSessionStatus(updatedSession.status);
            }
        });
    }

    // ─── File selection ──────────────────────────────────────────

    handleFileSelection(file: File) {
        if (this.st.isGeneratingLink()) return;

        // Case 3: pending session resume — check if file matches
        if (this.st.hasPendingBurnSession()) {
            const pending = this.signaling.getPendingSession();
            if (pending && file.name === pending.fileName && file.size === pending.fileSize) {
                this.resumePendingSession(file, pending);
                return;
            } else {
                // Wrong file — discard pending session and start fresh
                this.signaling.clearPendingSession();
                this.st.hasPendingBurnSession.set(false);
                this.st.pendingSessionFileName.set('');
                this.st.generatedLink.set('');
                this.st.linkId.set('');
            }
        }

        const maxSize = this.r2.getMaxFileSize();
        if (maxSize !== null && file.size > maxSize) {
            this.modal.showWarning(
                this.translate.instant('UPLOAD.MODAL_ERROR_TITLE'),
                this.translate.instant('UPLOAD.FILE_TOO_LARGE', { maxSize: this.formatFileSize(maxSize) })
            );
            return;
        }
        this.st.selectedFile.set(file);
        this.analytics.trackEvent('file_selected', {
            file_size_category: this.analytics.fileSizeCategory(file.size),
            file_type: file.type || 'unknown',
        });
    }

    cancelResume(): void {
        this.signaling.clearPendingSession();
        this.st.hasPendingBurnSession.set(false);
        this.st.pendingSessionFileName.set('');
        this.st.generatedLink.set('');
        this.st.linkId.set('');
    }

    private async resumePendingSession(file: File, pending: PendingBurnSession): Promise<void> {
        this.st.selectedFile.set(file);
        this.st.isGeneratingLink.set(true);
        try {
            await this.signaling.resumeBurnSession(file, pending.linkId, pending.r2Token, pending.fileHash);
            this.st.hasPendingBurnSession.set(false);

            const linkId = pending.linkId;
            this.st.linkId.set(linkId);
            this.sessionSub?.unsubscribe();
            this.sessionSub = this.signaling.getSessionUpdates$().subscribe(updatedSession => {
                if (updatedSession.linkId === linkId) {
                    this.st.session.set(updatedSession);
                    this.handleSessionStatus(updatedSession.status);
                }
            });
        } catch (error: any) {
            console.error('Error resuming burn session:', error);
            this.signaling.clearPendingSession();
            this.st.hasPendingBurnSession.set(false);
            this.modal.showError(
                this.translate.instant('UPLOAD.MODAL_ERROR_TITLE'),
                this.translate.instant('UPLOAD.MODAL_ERROR_MSG')
            );
        } finally {
            this.st.isGeneratingLink.set(false);
        }
    }

    clearFile() {
        this.st.selectedFile.set(null);
    }

    // ─── Link generation ─────────────────────────────────────────

    async generateLink() {
        const file = this.st.selectedFile();
        if (!file) return;

        if (!this.supabase.canUploadToday()) {
            this.modal.showWarning(
                this.translate.instant('UPLOAD.MODAL_LIMIT_TITLE'),
                this.translate.instant('UPLOAD.MODAL_LIMIT_MSG')
            );
            return;
        }

        if (this.st.transferMethod() === 'cloud') {
            await this.generateCloudLink();
        } else {
            await this.generateBurnLink();
        }
    }

    /**
     * Burn (streaming diretto): SignalingService gestisce token R2 + DB + signaling.
     * Il mittente deve tenere la pagina aperta.
     */
    private async generateBurnLink() {
        const file = this.st.selectedFile()!;

        if (this.st.mode() === 'seed' && !this.supabase.isAuthenticated()) {
            this.modal.showWarning(
                this.translate.instant('UPLOAD.MODAL_AUTH_TITLE'),
                this.translate.instant('UPLOAD.MODAL_AUTH_MSG')
            );
            return;
        }

        const slug = this.st.showCustomSlug() && this.st.customSlug() ? this.st.customSlug().trim() : undefined;
        if (slug && !this.validateSlug(slug)) return;

        this.st.isGeneratingLink.set(true);
        this.analytics.trackEvent('transfer_started', {
            method: 'p2p',
            file_size_category: this.analytics.fileSizeCategory(file.size),
        });

        try {
            const { linkId, session } = await this.signaling.startSenderSession(
                file,
                this.st.mode(),
                undefined,
                (progress) => this.st.hashProgress.set(Math.round(progress)),
                this.isPremium() && slug ? slug : undefined,
                { transfer_type: 'burn', retention_policy: 'burn' },
            );

            this.st.linkId.set(linkId);
            this.st.session.set(session);

            const linkPath = this.isPremium() && slug ? slug : linkId;
            await this.setLinkAndQR(linkPath);

            this.sessionSub?.unsubscribe();
            this.sessionSub = this.signaling.getSessionUpdates$().subscribe(updatedSession => {
                if (updatedSession.linkId === linkId) {
                    this.st.session.set(updatedSession);
                    this.handleSessionStatus(updatedSession.status);
                }
            });
        } catch (error: any) {
            console.error('Error generating burn link:', error);
            this.modal.showError(this.translate.instant('UPLOAD.MODAL_ERROR_TITLE'), this.translate.instant('UPLOAD.MODAL_ERROR_MSG'));
        } finally {
            this.st.isGeneratingLink.set(false);
        }
    }

    /**
     * Cloud (premium, persistente): hash → upload R2 → record DB → link.
     */
    private async generateCloudLink() {
        if (!this.isPremium()) {
            this.modal.showPremium(
                this.translate.instant('UPLOAD.MODAL_PREMIUM_TITLE'),
                this.translate.instant('UPLOAD.MODAL_PREMIUM_CLOUD_MSG')
            ).subscribe((confirmed) => {
                if (confirmed) this.router.navigate(['/pricing']);
            });
            return;
        }

        const file = this.st.selectedFile()!;

        const maxSize = this.r2.getMaxCloudFileSize();
        if (file.size > maxSize) {
            this.modal.showWarning(
                this.translate.instant('UPLOAD.MODAL_ERROR_TITLE'),
                this.translate.instant('UPLOAD.CLOUD_FILE_TOO_LARGE', { maxSize: this.formatFileSize(maxSize) })
            );
            return;
        }

        const slug = this.st.showCustomSlug() && this.st.customSlug() ? this.st.customSlug().trim() : undefined;
        if (slug && !this.validateSlug(slug)) return;

        this.st.isGeneratingLink.set(true);
        this.analytics.trackEvent('transfer_started', {
            method: 'cloud',
            file_size_category: this.analytics.fileSizeCategory(file.size),
        });
        this.transferStartTs = Date.now();

        try {
            const fileHash = await this.hasher.calculateHash(file, (p) => {
                this.st.hashProgress.set(Math.round(p));
            });

            // Compute expiry: burn-on-read → 24h safety net; 3day → 3 days
            const retentionPolicy = this.st.retentionPolicy() === '3day' ? '3day' as const : 'burn' as const;
            const expiryDays = retentionPolicy === '3day' ? 3 : 1;
            const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

            // Password encryption (cloud only, premium)
            const password = this.st.uploadPassword();
            let uploadBlob: File = file;
            let isPasswordProtected = false;

            if (password) {
                const arrayBuffer = await file.arrayBuffer();
                const encrypted = await this.crypto.encryptWithPassword(arrayBuffer, password);
                // Format: [salt (16B)] + [iv (12B)] + [ciphertext]
                const header = new Uint8Array(16 + 12);
                header.set(encrypted.salt, 0);
                header.set(encrypted.iv, 16);
                const encryptedBlob = new Blob([header, encrypted.ciphertext]);
                uploadBlob = new File([encryptedBlob], file.name, { type: file.type || 'application/octet-stream' });
                isPasswordProtected = true;
            }

            this.st.isCloudUploading.set(true);
            this.cloudProgressInterval = setInterval(() => {
                this.st.cloudUploadProgress.set(this.r2.uploadProgress());
            }, 200);

            const meta = await this.r2.upload(uploadBlob, retentionPolicy, fileHash);

            this.clearCloudProgressInterval();
            this.st.isCloudUploading.set(false);

            const linkId = this.crypto.generateLinkId(12);
            const userId = this.supabase.currentUser()?.id || null;
            const transferData: any = {
                sender_id: userId,
                file_name: file.name,
                file_size: file.size,
                file_hash: fileHash,
                mode: 'seed',
                link_id: linkId,
                password_protected: isPasswordProtected,
                transfer_type: 'cloud',
                retention_policy: retentionPolicy,
                r2_token: meta.token,
                expires_at: expiresAt,
            };
            if (this.isPremium() && slug) transferData.custom_slug = slug;

            await this.supabase.createFileTransfer(transferData);

            if (!this.supabase.isPremium()) {
                await this.supabase.incrementDailyFileCount();
            }

            this.st.linkId.set(linkId);
            const linkPath = this.isPremium() && slug ? slug : linkId;
            await this.setLinkAndQR(linkPath);
            this.analytics.trackEvent('transfer_completed', {
                method: 'cloud',
                file_size_category: this.analytics.fileSizeCategory(file.size),
                duration_seconds: Math.round((Date.now() - this.transferStartTs) / 1000),
            });

        } catch (error: any) {
            this.clearCloudProgressInterval();
            this.st.isCloudUploading.set(false);
            console.error('Error generating cloud link:', error);
            this.modal.showError(this.translate.instant('UPLOAD.MODAL_ERROR_TITLE'), this.translate.instant('UPLOAD.MODAL_ERROR_MSG'));
        } finally {
            this.st.isGeneratingLink.set(false);
        }
    }

    private async setLinkAndQR(linkPath: string) {
        const fullLink = `${window.location.origin}/download/${linkPath}`;
        this.st.generatedLink.set(fullLink);

        try {
            const qrUrl = await QRCode.toDataURL(fullLink, {
                width: 240,
                margin: 2,
                color: { dark: '#ffffff', light: '#0f172a' }
            });
            this.st.qrCodeUrl.set(qrUrl);
            this.analytics.trackEvent('qr_generated');
        } catch (err) {
            console.error('QR Code generation failed', err);
        }
    }

    // ─── Session status handling ──────────────────────────────────

    private handleSessionStatus(status: string) {
        if (status === 'connecting') {
            this.modal.showInfo(
                this.translate.instant('UPLOAD.MODAL_CONNECTING_TITLE'),
                this.translate.instant('UPLOAD.MODAL_CONNECTING_MSG')
            );
        } else if (status === 'transferring') {
            this.modal?.close();
            this.transferStartTs = Date.now();
            this.st.isBurnUploading.set(true);
            // Start polling burn progress
            this.clearBurnProgressInterval();
            this.burnProgressInterval = setInterval(() => {
                this.st.burnUploadProgress.set(this.signaling.senderProgress());
            }, 200);
        } else if (status === 'completed') {
            this.clearBurnProgressInterval();
            this.st.isBurnUploading.set(false);
            this.handleTransferComplete();
        } else if (status === 'error') {
            this.clearBurnProgressInterval();
            this.st.isBurnUploading.set(false);
            this.modal.showError(
                this.translate.instant('UPLOAD.MODAL_ERROR_TITLE'),
                this.translate.instant('UPLOAD.MODAL_TRANSFER_ERROR')
            );
        }
    }

    handleTransferComplete() {
        const file = this.st.selectedFile();
        const duration = this.transferStartTs > 0
            ? Math.round((Date.now() - this.transferStartTs) / 1000)
            : undefined;
        this.analytics.trackEvent('transfer_completed', {
            method: this.st.transferMethod(),
            file_size_category: file ? this.analytics.fileSizeCategory(file.size) : 'unknown',
            ...(duration !== undefined && { duration_seconds: duration }),
        });
        const isBurnMode = this.st.mode() === 'burn';

        this.modal.showSuccess(
            this.translate.instant('UPLOAD.MODAL_COMPLETE_TITLE'),
            isBurnMode
                ? this.translate.instant('UPLOAD.MODAL_COMPLETE_BURN')
                : this.translate.instant('UPLOAD.MODAL_COMPLETE_SEED')
        );

        if (isBurnMode) {
            setTimeout(() => this.reset(), 5000);
        }
    }

    cancelCloudUpload() {
        this.r2.abort();
        this.clearCloudProgressInterval();
        this.st.isCloudUploading.set(false);
        this.st.cloudUploadProgress.set(null);
        this.st.isGeneratingLink.set(false);
    }

    private clearCloudProgressInterval() {
        if (this.cloudProgressInterval) {
            clearInterval(this.cloudProgressInterval);
            this.cloudProgressInterval = null;
        }
    }

    private clearBurnProgressInterval() {
        if (this.burnProgressInterval) {
            clearInterval(this.burnProgressInterval);
            this.burnProgressInterval = null;
        }
    }

    // ─── Reset ───────────────────────────────────────────────────

    reset() {
        const currentLinkId = this.st.linkId();
        const wasBurn = this.st.transferMethod() === 'burn';
        this.sessionSub?.unsubscribe();
        this.clearCloudProgressInterval();
        this.clearBurnProgressInterval();
        this.st.reset();
        if (wasBurn && currentLinkId) {
            this.signaling.closeSession(currentLinkId);
        }
    }

    // ─── Premium gates ───────────────────────────────────────────

    toggleCustomSlug() {
        if (!this.isPremium()) {
            this.modal.showPremium(
                this.translate.instant('UPLOAD.MODAL_PREMIUM_TITLE'),
                this.translate.instant('UPLOAD.MODAL_PREMIUM_URL_MSG')
            ).subscribe((confirmed) => {
                if (confirmed) this.router.navigate(['/pricing']);
            });
            return;
        }
        this.st.showCustomSlug.update(current => !current);
        if (!this.st.showCustomSlug()) {
            this.st.customSlug.set('');
            this.st.customSlugError.set('');
        }
    }

    setCloudMode() {
        if (!this.isPremium()) {
            this.modal.showPremium(
                this.translate.instant('UPLOAD.MODAL_PREMIUM_TITLE'),
                this.translate.instant('UPLOAD.MODAL_PREMIUM_CLOUD_MSG')
            ).subscribe((confirmed) => {
                if (confirmed) this.router.navigate(['/pricing']);
            });
            return;
        }
        this.st.transferMethod.set('cloud');
        this.st.retentionPolicy.set('burn');
        this.analytics.trackEvent('transfer_method_selected', { method: 'cloud' });
    }

    protected setPersistentMode() {
        if (!this.isPremium()) {
            this.modal.showPremium(
                this.translate.instant('UPLOAD.MODAL_PREMIUM_TITLE'),
                this.translate.instant('UPLOAD.MODAL_PREMIUM_SEED_MSG')
            ).subscribe((confirmed) => {
                if (confirmed) this.router.navigate(['/pricing']);
            });
            return;
        }
        this.st.mode.set('seed');
    }

    // ─── Slug validation ─────────────────────────────────────────

    validateSlug(slug: string): boolean {
        if (slug.length < 3 || slug.length > 32) {
            this.st.customSlugError.set(this.translate.instant('UPLOAD.SLUG_ERROR_LENGTH'));
            return false;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
            this.st.customSlugError.set(this.translate.instant('UPLOAD.SLUG_ERROR_FORMAT'));
            return false;
        }
        this.st.customSlugError.set('');
        return true;
    }

    // ─── Sharing ────────────────────────────────────────────────

    async copyLink() {
        const link = this.st.generatedLink();
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            this.st.linkCopied.set(true);
            setTimeout(() => this.st.linkCopied.set(false), 2000);
            this.analytics.trackEvent('link_copied');
        } catch {
            this.modal.showError(this.translate.instant('UPLOAD.MODAL_ERROR_TITLE'), 'Impossibile copiare il link');
        }
    }

    async shareLink() {
        const link = this.st.generatedLink();
        const fileName = this.st.selectedFile()?.name;
        if (!link) return;
        try {
            this.analytics.trackEvent('link_shared');
            await navigator.share({
                title: this.translate.instant('UPLOAD.SHARE_TITLE'),
                text: fileName
                    ? this.translate.instant('UPLOAD.SHARE_TEXT_FILE', { filename: fileName })
                    : this.translate.instant('UPLOAD.SHARE_TEXT'),
                url: link,
            });
        } catch (error: any) {
            if (error?.name !== 'AbortError') console.error('Share error:', error);
        }
    }

    get canShare(): boolean {
        return typeof navigator !== 'undefined' && !!navigator.share;
    }

    // ─── Utilities ───────────────────────────────────────────────

    isFileTooLargeForCloud(): boolean {
        const file = this.st.selectedFile();
        return !!file && file.size > this.r2.getMaxCloudFileSize();
    }

    get maxCloudFileSizeFormatted(): string {
        return this.formatFileSize(this.r2.getMaxCloudFileSize());
    }

    formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    formatSpeed(bytesPerSecond: number): string {
        return this.formatFileSize(bytesPerSecond) + '/s';
    }

    isPremium(): boolean {
        return this.userProfile()?.tier === 'premium';
    }

    getModeIcon(): string {
        return this.st.mode() === 'burn' ? '🔥' : '🌱';
    }

    getModeLabel(): string {
        return this.st.mode() === 'burn'
            ? this.translate.instant('UPLOAD.MODE_BURN_FULL')
            : this.translate.instant('UPLOAD.MODE_SEED_FULL');
    }

    getModeDescription(): string {
        return this.st.mode() === 'burn'
            ? this.translate.instant('UPLOAD.MODE_BURN_DESC_LINK')
            : this.translate.instant('UPLOAD.MODE_SEED_DESC_LINK');
    }
}
