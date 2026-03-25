import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '@shared/components/header.component';
import { SignalingService } from '@core/services/signaling.service';
import { SupabaseService } from '@core/services/supabase.service';
import { ModalService } from '@core/services/modal.service';
import { R2TransferService } from '@core/services/r2-transfer.service';
import { HasherService } from '@core/services/transfer/hasher.service';
import { CryptoService } from '@core/services/crypto.service';
import { RetentionPolicy } from '@core/services/r2-transfer.types';
import { UploadStateService } from '../../services/upload-state.service';
import { Subscription } from 'rxjs';
import * as QRCode from 'qrcode';
import { DropZoneComponent } from './drop-zone/drop-zone.component';
import { AdBannerComponent } from '@shared/components/ad-banner.component';

@Component({
    selector: 'app-upload',
    standalone: true,
    imports: [CommonModule, FormsModule, HeaderComponent, RouterLink, DropZoneComponent, TranslateModule, AdBannerComponent],
    templateUrl: './upload.component.html',
    styleUrls: ['./upload.component.css']
})
export class UploadComponent implements OnInit, OnDestroy {
    // Lo stato è nel service singleton; esponiamo il service al template
    readonly st: UploadStateService;

    // Alias per il template (backward compat con le binding esistenti)
    get selectedFile() {
        return this.st.selectedFile;
    }

    get generatedLink() {
        return this.st.generatedLink;
    }

    get qrCodeUrl() {
        return this.st.qrCodeUrl;
    }

    get isGeneratingLink() {
        return this.st.isGeneratingLink;
    }

    get linkCopied() {
        return this.st.linkCopied;
    }

    get hashProgress() {
        return this.st.hashProgress;
    }

    get mode() {
        return this.st.mode;
    }

    get password() {
        return this.st.password;
    }

    get showPasswordInput() {
        return this.st.showPasswordInput;
    }

    get customSlug() {
        return this.st.customSlug;
    }

    get showCustomSlug() {
        return this.st.showCustomSlug;
    }

    get customSlugError() {
        return this.st.customSlugError;
    }

    get isTransferring() {
        return this.st.isTransferring;
    }

    get isRetrying() {
        return this.st.isRetrying;
    }

    get session() {
        return this.st.session;
    }

    get transferMethod() {
        return this.st.transferMethod;
    }

    get retentionPolicy() {
        return this.st.retentionPolicy;
    }

    get isCloudUploading() {
        return this.st.isCloudUploading;
    }

    get cloudUploadProgress() {
        return this.st.cloudUploadProgress;
    }

    // User profile
    userProfile = this.supabase.currentProfile;

    private sessionSub?: Subscription;

    private cloudProgressInterval: ReturnType<typeof setInterval> | null = null;

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
    ) {
        this.st = uploadState;
    }

    ngOnInit() {
        if (this.st.hasActiveSession()) {
            // Ripristina la subscription se l'utente torna alla pagina durante un trasferimento
            this.reattachSessionSubscription();
        } else {
            // Primo accesso: controlla se un file è stato passato dalla home
            const file = history.state?.file;
            if (file instanceof File) {
                this.st.selectedFile.set(file);
            }
        }
    }

    ngOnDestroy() {
        this.sessionSub?.unsubscribe();
        this.clearCloudProgressInterval();

        if (this.st.transferMethod() === 'cloud') {
            // Cloud: abort se upload in corso, altrimenti niente da fare
            if (this.st.isCloudUploading()) {
                this.r2.abort();
                this.st.isCloudUploading.set(false);
                this.st.isGeneratingLink.set(false);
            }
        } else {
            // P2P: chiudi sessione WebRTC solo se non in trasferimento
            if (!this.st.isTransferring() && !this.st.isRetrying()) {
                if (this.st.linkId()) {
                    this.signaling.closeSession(this.st.linkId());
                }
                this.signaling.terminateWorkers();
                if (!this.st.generatedLink()) {
                    this.st.reset();
                }
            }
        }
    }

    /**
     * Riattacca la subscription agli aggiornamenti di sessione senza aprire una nuova sessione.
     * Usata quando l'utente torna alla pagina durante un trasferimento attivo.
     */
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

    /**
     * Gestisce selezione file dalla drop zone
     */
    handleFileSelection(file: File) {
        if (this.st.isGeneratingLink()) return;
        this.st.selectedFile.set(file);
    }

    /**
     * Rimuove il file selezionato per permetterne la sostituzione
     */
    clearFile() {
        this.st.selectedFile.set(null);
    }

    /**
     * Genera il link di condivisione (chiamata al click di "Crea Link")
     */
    async generateLink() {
        const file = this.st.selectedFile();
        if (!file) return;

        // Check daily limit
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
            await this.generateP2PLink();
        }
    }

    /**
     * Cloud path: hash → upload R2 → crea record DB → genera link
     */
    private async generateCloudLink() {
        const file = this.st.selectedFile()!;

        // Validate cloud file size
        const maxSize = this.r2.getMaxCloudFileSize();
        if (file.size > maxSize) {
            this.modal.showWarning(
                this.translate.instant('UPLOAD.MODAL_ERROR_TITLE'),
                this.translate.instant('UPLOAD.CLOUD_FILE_TOO_LARGE', { maxSize: this.formatFileSize(maxSize) })
            );
            return;
        }

        // Valida password se impostata (Premium only)
        const password = this.st.showPasswordInput() && this.st.password() ? this.st.password() : undefined;
        if (password && !this.isPremium()) {
            this.modal.showWarning(
                this.translate.instant('UPLOAD.MODAL_PREMIUM_TITLE'),
                this.translate.instant('UPLOAD.MODAL_PREMIUM_PASSWORD_MSG')
            );
            this.st.password.set('');
            this.st.showPasswordInput.set(false);
        }

        // Valida custom slug se impostato
        const slug = this.st.showCustomSlug() && this.st.customSlug() ? this.st.customSlug().trim() : undefined;
        if (slug && !this.validateSlug(slug)) return;

        this.st.isGeneratingLink.set(true);

        try {
            // 1. Hash file
            const fileHash = await this.hasher.calculateHash(file, (p) => {
                this.st.hashProgress.set(Math.round(p));
            });

            // 2. Upload to R2
            this.st.isCloudUploading.set(true);
            this.cloudProgressInterval = setInterval(() => {
                this.st.cloudUploadProgress.set(this.r2.uploadProgress());
            }, 200);

            const meta = await this.r2.upload(file, this.st.retentionPolicy(), fileHash);

            this.clearCloudProgressInterval();
            this.st.isCloudUploading.set(false);

            // 3. Create DB record
            const linkId = this.crypto.generateLinkId(12);
            const userId = this.supabase.currentUser()?.id || null;
            const retentionPolicy = this.st.retentionPolicy();

            const transferData: any = {
                sender_id: userId,
                file_name: file.name,
                file_size: file.size,
                file_hash: fileHash,
                mode: retentionPolicy === 'burn' ? 'burn' : 'seed',
                link_id: linkId,
                password_protected: !!password,
                transfer_type: 'cloud',
                retention_policy: retentionPolicy,
                r2_token: meta.token,
            };
            if (this.isPremium() && slug) {
                transferData.custom_slug = slug;
            }

            await this.supabase.createFileTransfer(transferData);

            if (!this.supabase.isPremium()) {
                await this.supabase.incrementDailyFileCount();
            }

            // 4. Generate link + QR
            this.st.linkId.set(linkId);
            const linkPath = this.isPremium() && slug ? slug : linkId;
            await this.setLinkAndQR(linkPath);

        } catch (error: any) {
            this.clearCloudProgressInterval();
            this.st.isCloudUploading.set(false);
            console.error('Error generating cloud link:', error);
            this.modal.showError(this.translate.instant('UPLOAD.MODAL_ERROR_TITLE'), error.message || 'Impossibile generare il link');
        } finally {
            this.st.isGeneratingLink.set(false);
        }
    }

    /**
     * P2P path: hash → WebRTC session → attende receiver
     */
    private async generateP2PLink() {
        const file = this.st.selectedFile()!;

        // Enforce: modalità persistente solo per utenti autenticati
        if (this.st.mode() === 'seed' && !this.supabase.isAuthenticated()) {
            this.modal.showWarning(
                this.translate.instant('UPLOAD.MODAL_AUTH_TITLE'),
                this.translate.instant('UPLOAD.MODAL_AUTH_MSG')
            );
            return;
        }

        this.st.isGeneratingLink.set(true);

        try {
            const password = this.st.showPasswordInput() && this.st.password() ? this.st.password() : undefined;
            if (password && !this.isPremium()) {
                this.modal.showWarning(
                    this.translate.instant('UPLOAD.MODAL_PREMIUM_TITLE'),
                    this.translate.instant('UPLOAD.MODAL_PREMIUM_PASSWORD_MSG')
                );
                this.st.password.set('');
                this.st.showPasswordInput.set(false);
            }

            const slug = this.st.showCustomSlug() && this.st.customSlug() ? this.st.customSlug().trim() : undefined;
            if (slug && !this.validateSlug(slug)) return;

            const { linkId, session } = await this.signaling.startSenderSession(
                file,
                this.st.mode(),
                this.isPremium() && password ? password : undefined,
                (progress) => {
                    this.st.hashProgress.set(Math.round(progress));
                },
                this.isPremium() && slug ? slug : undefined,
                {
                    transfer_type: 'p2p',
                    retention_policy: this.st.mode() === 'burn' ? 'burn' : 'permanent',
                    r2_token: null,
                }
            );

            this.st.linkId.set(linkId);
            this.st.session.set(session);

            const linkPath = this.isPremium() && slug ? slug : linkId;
            await this.setLinkAndQR(linkPath);

            // Subscribe to session updates
            this.sessionSub?.unsubscribe();
            this.sessionSub = this.signaling.getSessionUpdates$().subscribe(updatedSession => {
                if (updatedSession.linkId === linkId) {
                    this.st.session.set(updatedSession);
                    this.handleSessionStatus(updatedSession.status);
                }
            });

        } catch (error: any) {
            console.error('Error generating P2P link:', error);
            this.modal.showError(this.translate.instant('UPLOAD.MODAL_ERROR_TITLE'), error.message || 'Impossibile generare il link');
        } finally {
            this.st.isGeneratingLink.set(false);
        }
    }

    /**
     * Genera URL completo e QR code (shared tra cloud e P2P)
     */
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
        } catch (err) {
            console.error('QR Code generation failed', err);
        }
    }

    /**
     * Annulla upload cloud in corso
     */
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

    /**
     * Check se il file supera il limite cloud
     */
    isFileTooLargeForCloud(): boolean {
        const file = this.st.selectedFile();
        return !!file && file.size > this.r2.getMaxCloudFileSize();
    }

    get maxCloudFileSizeFormatted(): string {
        return this.formatFileSize(this.r2.getMaxCloudFileSize());
    }

    /**
     * Centralizza la gestione degli aggiornamenti di stato sessione
     */
    private handleSessionStatus(status: string) {
        if (status === 'connecting') {
            this.st.isTransferring.set(false);
            this.st.isRetrying.set(false);
            this.modal.showInfo(
                this.translate.instant('UPLOAD.MODAL_CONNECTING_TITLE'),
                this.translate.instant('UPLOAD.MODAL_CONNECTING_MSG')
            );
        } else if (status === 'connected') {
            this.startFileTransfer();
        } else if (status === 'transferring') {
            this.modal?.close();
            this.st.isRetrying.set(false);
            this.st.isTransferring.set(true);
        } else if (status === 'completed') {
            this.handleTransferComplete();
        } else if (status === 'retry-waiting') {
            this.modal?.close();
            this.st.isTransferring.set(false);
            this.st.isRetrying.set(true);
        } else if (status === 'disconnected') {
            this.modal.showError(
                this.translate.instant('UPLOAD.MODAL_DISCONNECTED_TITLE'),
                this.translate.instant('UPLOAD.MODAL_DISCONNECTED_MSG')
            );
        } else if (status === 'error') {
            this.modal.showError(
                this.translate.instant('UPLOAD.MODAL_ERROR_TITLE'),
                this.translate.instant('UPLOAD.MODAL_TRANSFER_ERROR')
            );
        }
    }

    /**
     * Avvia trasferimento file
     */
    async startFileTransfer() {
        const file = this.st.selectedFile();
        const linkId = this.st.linkId();
        if (!file || !linkId) return;

        this.st.isTransferring.set(true);
        this.modal?.close();

        try {
            await this.signaling.sendFileWhenReady(linkId);
        } catch (error: any) {
            console.error('Transfer error:', error);
            this.modal.showError(this.translate.instant('UPLOAD.MODAL_TRANSFER_ERROR'), error.message);
        }
    }

    /**
     * Gestisce completamento trasferimento
     */
    handleTransferComplete() {
        this.st.isTransferring.set(false);

        const isBurnMode = this.st.mode() === 'burn';

        this.modal.showSuccess(
            this.translate.instant('UPLOAD.MODAL_COMPLETE_TITLE'),
            isBurnMode
                ? this.translate.instant('UPLOAD.MODAL_COMPLETE_BURN')
                : this.translate.instant('UPLOAD.MODAL_COMPLETE_SEED')
        );

        if (isBurnMode) {
            setTimeout(() => {
                this.reset();
            }, 5000);
        }
    }

    /**
     * Controlla se il browser supporta la Web Share API
     */
    get canShare(): boolean {
        return typeof navigator !== 'undefined' && !!navigator.share;
    }

    /**
     * Copia link negli appunti
     */
    async copyLink() {
        const link = this.st.generatedLink();
        if (!link) return;

        try {
            await navigator.clipboard.writeText(link);
            this.st.linkCopied.set(true);

            setTimeout(() => {
                this.st.linkCopied.set(false);
            }, 2000);
        } catch (error) {
            this.modal.showError(this.translate.instant('UPLOAD.MODAL_ERROR_TITLE'), 'Impossibile copiare il link');
        }
    }

    /**
     * Condivide il link usando la Web Share API nativa del browser
     */
    async shareLink() {
        const link = this.st.generatedLink();
        const fileName = this.st.selectedFile()?.name;
        if (!link) return;

        try {
            await navigator.share({
                title: this.translate.instant('UPLOAD.SHARE_TITLE'),
                text: fileName
                    ? this.translate.instant('UPLOAD.SHARE_TEXT_FILE', { filename: fileName })
                    : this.translate.instant('UPLOAD.SHARE_TEXT'),
                url: link,
            });
        } catch (error: any) {
            // L'utente ha annullato: non mostrare errore
            if (error?.name !== 'AbortError') {
                console.error('Share error:', error);
            }
        }
    }

    /**
     * Toggle custom slug input
     */
    toggleCustomSlug() {
        if (!this.isPremium()) {
            this.modal.showPremium(
                this.translate.instant('UPLOAD.MODAL_PREMIUM_TITLE'),
                this.translate.instant('UPLOAD.MODAL_PREMIUM_URL_MSG')
            ).subscribe(async (confirmed) => {
                if (confirmed) {
                    this.router.navigate(['/pricing']);
                }
            });
            return;
        }
        this.st.showCustomSlug.update(current => !current);
        if (!this.st.showCustomSlug()) {
            this.st.customSlug.set('');
            this.st.customSlugError.set('');
        }
    }

    /**
     * Valida slug personalizzato
     */
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

    /**
     * Toggle password input
     */
    togglePasswordInput() {
        if (!this.isPremium()) {
            this.modal.showPremium(
                this.translate.instant('UPLOAD.MODAL_PREMIUM_TITLE'),
                this.translate.instant('UPLOAD.MODAL_PREMIUM_PASSWORD_MSG')
            ).subscribe(async (confirmed) => {
                if (confirmed) {
                    this.router.navigate(['/pricing']);
                }
            });
            return;
        }

        this.st.showPasswordInput.update(current => !current);
    }

    /**
     * Reset completo: chiude la sessione e pulisce tutto lo stato
     */
    reset() {
        const currentLinkId = this.st.linkId();
        const wasCloud = this.st.transferMethod() === 'cloud';
        this.sessionSub?.unsubscribe();
        this.clearCloudProgressInterval();
        this.st.reset();
        if (!wasCloud && currentLinkId) {
            this.signaling.closeSession(currentLinkId);
        }
    }

    /**
     * Utilities
     */
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

    protected setPersistentMode() {
        if (!this.isPremium()) {
            this.modal.showPremium(
                this.translate.instant('UPLOAD.MODAL_PREMIUM_TITLE'),
                this.translate.instant('UPLOAD.MODAL_PREMIUM_SEED_MSG')
            ).subscribe(async (confirmed) => {
                if (confirmed) {
                    this.router.navigate(['/pricing']);
                }
            });
            return;
        }

        this.st.mode.set('seed');
    }

    /**
     * Imposta retention "permanent" (premium-gated)
     */
    setRetentionPermanent() {
        if (!this.isPremium()) {
            this.modal.showPremium(
                this.translate.instant('UPLOAD.MODAL_PREMIUM_TITLE'),
                this.translate.instant('UPLOAD.RETENTION_PERMANENT_PREMIUM_MSG')
            ).subscribe(async (confirmed) => {
                if (confirmed) {
                    this.router.navigate(['/pricing']);
                }
            });
            return;
        }
        this.st.retentionPolicy.set('permanent');
    }

    getRetentionIcon(): string {
        const r = this.st.retentionPolicy();
        return r === 'burn' ? '🔥' : r === '3day' ? '⏱️' : '♾️';
    }

    getRetentionLabel(): string {
        const r = this.st.retentionPolicy();
        return r === 'burn'
            ? this.translate.instant('UPLOAD.RETENTION_BURN')
            : r === '3day'
                ? this.translate.instant('UPLOAD.RETENTION_3DAY')
                : this.translate.instant('UPLOAD.RETENTION_PERMANENT');
    }

    getRetentionDescription(): string {
        const r = this.st.retentionPolicy();
        return r === 'burn'
            ? this.translate.instant('UPLOAD.RETENTION_BURN_DESC')
            : r === '3day'
                ? this.translate.instant('UPLOAD.RETENTION_3DAY_DESC')
                : this.translate.instant('UPLOAD.RETENTION_PERMANENT_DESC');
    }
}
