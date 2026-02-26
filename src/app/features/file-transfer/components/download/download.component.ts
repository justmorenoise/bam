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

@Component({
    selector: 'app-download',
    standalone: true,
    imports: [CommonModule, FormsModule, HeaderComponent, RouterLink, AdBannerComponent, TranslateModule],
    templateUrl: './download.component.html',
    styleUrls: ['./download.component.css']
})
export class DownloadComponent implements OnInit, OnDestroy {
    linkId = signal('');
    session = signal<FileShareSession | null>(null);
    password = signal('');
    isLoading = signal(false);
    isConnecting = signal(false);
    isDownloading = signal(false);
    isVerifying = signal(false);
    isCompleted = signal(false);
    errorMessage = signal('');
    avgSpeed = signal(0);
    elapsedSeconds = signal(0);
    file = signal<Blob | undefined>(undefined);

    // Canali paralleli attivi (UI indicator)
    parallelChannels = signal(0);

    private sessionSub?: Subscription;
    private transferSub?: Subscription;
    private downloadStartTs = 0;
    private _fileName: string = '';

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        protected signaling: SignalingService,
        private supabase: SupabaseService,
        private translate: TranslateService,
    ) {
    }

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
        this.transferSub?.unsubscribe();
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

            // Subscribe to session updates
            this.sessionSub = this.signaling.getSessionUpdates$().subscribe(updatedSession => {
                if (updatedSession.linkId === this.linkId()) {

                    const currentSession = this.session();
                    if (!currentSession || currentSession.status !== updatedSession.status) {
                        console.log(`DownloadComponent.`, updatedSession.status);
                    }

                    this.session.set(updatedSession);

                    if (updatedSession.status === 'connecting') {
                        this.isConnecting.set(true);
                    } else if (updatedSession.status === 'waiting') {
                        this.isConnecting.set(true);
                        this.isDownloading.set(false);

                    } else if (updatedSession.status === 'connected') {
                        this.isConnecting.set(false);
                        if (!this.isDownloading()) {
                            this.startDownload();
                        }
                    } else if (updatedSession.status === 'transferring') {
                        // Nuovo stato gestito: assicura che la UI mostri il progresso e che la sottoscrizione sia attiva
                        this.isConnecting.set(false);
                        if (!this.isDownloading()) {
                            this.startDownload();
                        }
                        this.isDownloading.set(true);
                    } else if (updatedSession.status === 'error') {
                        this.errorMessage.set(this.translate.instant('DOWNLOAD.ERROR_CONNECTION'));
                        this.isConnecting.set(false);
                        this.isDownloading.set(false);
                        this.isVerifying.set(false);
                    } else if (updatedSession.status === 'completed') {
                        this.isDownloading.set(false);
                    }
                }
            });
        } catch (error: any) {
            console.error('Error loading file info:', error);
            this.errorMessage.set(error.message || this.translate.instant('DOWNLOAD.ERROR_NOT_FOUND'));
        } finally {
            this.isLoading.set(false);
        }
    }

    startDownload() {
        if (!this.session()) return;

        // Check if password is required
        if (this.session()!.passwordProtected && !this.password()) {
            return; // Wait for password input
        }

        this.isCompleted.set(false);
        this.isDownloading.set(true);
        this.errorMessage.set('');
        this.downloadStartTs = Date.now();

        const pwd = this.session()!.passwordProtected ? this.password() : undefined;
        this.transferSub = this.signaling.receiveFile(
            this.linkId(),
            undefined,
            async (file, metadata) => {
                try {
                    // Calcola subito le statistiche di trasferimento (tempo e velocità media) al termine del download
                    const elapsed = Math.max(1, Math.round((Date.now() - this.downloadStartTs) / 1000));
                    this.elapsedSeconds.set(elapsed);
                    const size = metadata?.size ?? this.session()!.fileInfo.size;
                    this.avgSpeed.set(Math.floor(size / elapsed));

                    // L'integrità è già verificata dal receiver-engine prima di emettere il file.
                    // Se l'hash non combacia, onComplete non viene mai chiamata.
                    this.isDownloading.set(false);

                    this.file.set(file);
                    this._fileName = metadata.name;
                    // 2. Download completed: salva file e mostra schermata di successo con statistiche
                    this.downloadFile(file, metadata.name);

                    this.isCompleted.set(true);

                    // Add XP if user is logged in
                    if (this.supabase.isAuthenticated()) {
                        this.supabase.addXP(5);
                    }
                } catch (error: any) {
                    console.error('Integrity check error:', error);
                    this.errorMessage.set(this.translate.instant('DOWNLOAD.ERROR_VERIFY'));
                    this.isDownloading.set(false);
                }
            },
            pwd
        );
    }

    download() {
        const file = this.file();
        if (!file) return;
        this.downloadFile(file, this._fileName);
    }

    private downloadFile(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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
