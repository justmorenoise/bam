import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '@shared/components/modal/modal.component';
import { FooterComponent } from '@shared/components/footer.component';
import { AdInterstitialComponent } from '@shared/components/ad-interstitial.component';
import { TransferBannerComponent } from '@shared/components/transfer-banner/transfer-banner.component';
import { ToastComponent } from '@shared/components/toast/toast.component';
import { LanguageService } from '@core/services/language.service';
import { AdService } from '@core/services/ad.service';
import { DownloadNotificationService } from '@core/services/download-notification.service';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [CommonModule, RouterOutlet, ModalComponent, FooterComponent, AdInterstitialComponent, TransferBannerComponent, ToastComponent],
    template: `
        <div class="min-h-screen flex flex-col">
            <div class="flex-1">
                <router-outlet></router-outlet>
            </div>
            <app-footer/>
            <app-modal/>
            <app-ad-interstitial/>
            <app-transfer-banner/>
            <app-toast/>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
            height: 100%;
        }
    `]
})
export class AppComponent implements OnInit {
    title = 'Bam! - File Sharing';

    constructor(
        private languageService: LanguageService,
        private adService: AdService,
    ) {
        // Attiva il servizio root che si auto-sottoscrive all'auth state
        inject(DownloadNotificationService);
    }

    async ngOnInit(): Promise<void> {
        this.languageService.init();
        // Carica lo script AdSense una sola volta al boot.
        // Su Electron o utenti Premium il metodo è no-op.
        await this.adService.initialize();
    }
}
