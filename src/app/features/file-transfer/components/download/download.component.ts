import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '@shared/components/header.component';
import { FileShareSession, SignalingService } from '@core/services/signaling.service';
import { SupabaseService } from '@core/services/supabase.service';
import { Subscription } from 'rxjs';
import { AdBannerComponent } from '@shared/components/ad-banner.component';
import { HnNewsComponent } from '@shared/components/hn-news/hn-news.component';
import { R2TransferService } from '@core/services/r2-transfer.service';
import { AnalyticsService } from '@core/services/analytics.service';
import { CryptoService } from '@core/services/crypto.service';

@Component({
    selector: 'app-download',
    standalone: true,
    imports: [CommonModule, FormsModule, HeaderComponent, RouterLink, AdBannerComponent, TranslateModule, HnNewsComponent],
    templateUrl: './download.component.html',
    styleUrls: ['./download.component.css']
})
export class DownloadComponent implements OnInit, OnDestroy {
    linkId = signal('');
    session = signal<FileShareSession | null>(null);
    isLoading = signal(false);
    isConnecting = signal(false);
    isDownloading = signal(false);
    isCompleted = signal(false);
    errorMessage = signal('');
    warningMessage = signal('');
    avgSpeed = signal(0);
    elapsedSeconds = signal(0);

    // Password decryption
    showPasswordInput = signal(false);
    downloadPassword = signal('');
    showDownloadPasswordVisible = signal(false);
    isDecrypting = signal(false);
    passwordError = signal('');

    toggleDownloadPasswordVisible() { this.showDownloadPasswordVisible.update(v => !v); }

    private sessionSub?: Subscription;
    private downloadStartTs = 0;
    private progressInterval: ReturnType<typeof setInterval> | null = null;

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        protected signaling: SignalingService,
        private supabase: SupabaseService,
        private translate: TranslateService,
        protected r2Transfer: R2TransferService,
        private analytics: AnalyticsService,
        private crypto: CryptoService,
    ) {}

    ngOnInit() {
        const linkId = this.route.snapshot.paramMap.get('linkId');
        if (!linkId) {
            this.router.navigate(['/']);
            return;
        }
        this.linkId.set(linkId);
        this.loadFileInfo();
    }

    ngOnDestroy() {
        this.sessionSub?.unsubscribe();
        this.clearProgressInterval();
        if (this.linkId()) {
            this.signaling.closeSession(this.linkId());
        }
    }

    async loadFileInfo() {
        this.isLoading.set(true);
        this.errorMessage.set('');

        try {
            const session = await this.signaling.joinReceiverSession(this.linkId());
            this.session.set(session);

            this.sessionSub = this.signaling.getSessionUpdates$().subscribe(updatedSession => {
                if (updatedSession.linkId !== this.linkId()) return;

                this.session.set(updatedSession);

                switch (updatedSession.status) {
                    case 'waiting':
                    case 'connecting':
                        this.isConnecting.set(true);
                        this.isDownloading.set(false);
                        break;

                    case 'connected':
                        // Cloud transfer: start R2 download
                        this.isConnecting.set(false);
                        if (!this.isDownloading()) {
                            this.startCloudDownload(updatedSession.r2Token!, updatedSession.fileInfo.name);
                        }
                        break;

                    case 'transferring':
                        // Burn streaming: chunks arriving
                        this.isConnecting.set(false);
                        if (!this.isDownloading()) {
                            this.isDownloading.set(true);
                            this.downloadStartTs = Date.now();
                            this.analytics.trackEvent('download_started', {
                                method: 'p2p',
                                file_size_category: this.analytics.fileSizeCategory(updatedSession.fileInfo.size),
                            });
                            this.startBurnProgressTracking();
                        }
                        break;

                    case 'completed':
                        this.clearProgressInterval();
                        this.isDownloading.set(false);
                        this.isConnecting.set(false);

                        if (!this.isCompleted()) {
                            const elapsed = Math.max(1, Math.round((Date.now() - this.downloadStartTs) / 1000));
                            this.elapsedSeconds.set(elapsed);
                            const size = this.session()!.fileInfo.size;
                            this.avgSpeed.set(Math.floor(size / elapsed));
                            this.isCompleted.set(true);
                            this.analytics.trackEvent('download_completed', {
                                method: 'p2p',
                                file_size_category: this.analytics.fileSizeCategory(size),
                                duration_seconds: elapsed,
                            });

                            if (this.supabase.isAuthenticated()) {
                                this.supabase.addXP(5).catch(() => {});
                            }
                        }
                        break;

                    case 'error':
                        this.clearProgressInterval();
                        this.analytics.trackEvent('download_failed', { method: 'p2p' });
                        this.errorMessage.set(this.translate.instant('DOWNLOAD.ERROR_CONNECTION'));
                        this.isConnecting.set(false);
                        this.isDownloading.set(false);
                        break;
                }
            });

        } catch (error: any) {
            console.error('Error loading file info:', error);
            if (error.message?.includes('completed')) {
                this.warningMessage.set('completed');
            } else {
                this.errorMessage.set(this.translate.instant('DOWNLOAD.ERROR_NOT_FOUND'));
            }
        } finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Cloud (premium): full file download from R2.
     */
    private async startCloudDownload(r2Token: string, fileName: string) {
        // Password-protected: show input form instead of auto-downloading
        if (this.session()?.passwordProtected) {
            this.isConnecting.set(false);
            this.showPasswordInput.set(true);
            return;
        }

        this.isDownloading.set(true);
        this.errorMessage.set('');
        this.downloadStartTs = Date.now();
        const fileSize = this.session()?.fileInfo.size ?? 0;
        this.analytics.trackEvent('download_started', {
            method: 'cloud',
            file_size_category: this.analytics.fileSizeCategory(fileSize),
        });

        try {
            await this.supabase.sendDownloadNotification(this.linkId(), 'started', fileName).catch(() => {});
            await this.r2Transfer.download(r2Token, fileName);

            const elapsed = Math.max(1, Math.round((Date.now() - this.downloadStartTs) / 1000));
            this.elapsedSeconds.set(elapsed);
            const size = this.session()!.fileInfo.size;
            this.avgSpeed.set(Math.floor(size / elapsed));
            this.isDownloading.set(false);
            this.isCompleted.set(true);
            this.analytics.trackEvent('download_completed', {
                method: 'cloud',
                file_size_category: this.analytics.fileSizeCategory(size),
                duration_seconds: elapsed,
            });

            await this.supabase.sendDownloadNotification(this.linkId(), 'completed', fileName).catch(() => {});
            if (this.supabase.isAuthenticated()) {
                this.supabase.addXP(5).catch(() => {});
            }
            await this.supabase.incrementDownloadCount(this.linkId()).catch(() => {});
        } catch (error: any) {
            this.isDownloading.set(false);
            this.analytics.trackEvent('download_failed', { method: 'cloud' });
            this.errorMessage.set(this.translate.instant('DOWNLOAD.ERROR_CONNECTION'));
        }
    }

    /**
     * Password-protected cloud file: decrypt in-browser then trigger save.
     */
    async decryptAndDownload(): Promise<void> {
        const token = this.session()?.r2Token;
        const fileName = this.session()?.fileInfo.name;
        if (!token || !fileName) return;

        this.isDecrypting.set(true);
        this.passwordError.set('');
        this.isDownloading.set(true);
        this.downloadStartTs = Date.now();

        try {
            const encryptedBuffer = await this.r2Transfer.downloadToBuffer(token);

            // Header: [salt 16B][iv 12B][ciphertext...]
            const salt = new Uint8Array(encryptedBuffer, 0, 16);
            const iv = new Uint8Array(encryptedBuffer, 16, 12);
            const ciphertext = encryptedBuffer.slice(28);

            const decrypted = await this.crypto.decryptWithPassword(
                { ciphertext, iv, salt },
                this.downloadPassword()
            );

            // Trigger browser download of decrypted content
            const blob = new Blob([decrypted]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            const elapsed = Math.max(1, Math.round((Date.now() - this.downloadStartTs) / 1000));
            this.elapsedSeconds.set(elapsed);
            this.avgSpeed.set(Math.floor((this.session()?.fileInfo.size ?? 0) / elapsed));
            this.isDownloading.set(false);
            this.isCompleted.set(true);

            await this.supabase.incrementDownloadCount(this.linkId()).catch(() => {});
            if (this.supabase.isAuthenticated()) this.supabase.addXP(5).catch(() => {});
        } catch {
            this.isDownloading.set(false);
            this.passwordError.set(this.translate.instant('DOWNLOAD.PASSWORD_ERROR'));
        } finally {
            this.isDecrypting.set(false);
        }
    }

    /**
     * Burn streaming: track progress from ChunkedStreamService.
     * The actual download + browser save is handled by SignalingService.
     */
    private startBurnProgressTracking() {
        this.clearProgressInterval();
        this.progressInterval = setInterval(() => {
            const progress = this.signaling.receiverProgress();
            if (progress) {
                const elapsed = Math.max(1, (Date.now() - this.downloadStartTs) / 1000);
                this.avgSpeed.set(Math.floor(progress.speedBps));
                this.elapsedSeconds.set(Math.floor(elapsed));
            }
        }, 200);
    }

    private clearProgressInterval() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
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
}
