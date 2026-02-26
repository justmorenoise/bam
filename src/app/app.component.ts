import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '@shared/components/modal/modal.component';
import { FooterComponent } from '@shared/components/footer.component';
import { AdInterstitialComponent } from '@shared/components/ad-interstitial.component';
import { TransferBannerComponent } from '@shared/components/transfer-banner/transfer-banner.component';
import { LanguageService } from '@core/services/language.service';
import { AdService } from '@core/services/ad.service';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [CommonModule, RouterOutlet, ModalComponent, FooterComponent, AdInterstitialComponent, TransferBannerComponent],
    template: `
        <div class="min-h-screen flex flex-col">
            <div class="flex-1">
                <router-outlet></router-outlet>
            </div>
            <app-footer/>
            <app-modal/>
            <app-ad-interstitial/>
            <app-transfer-banner/>
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
    title = 'Bam! - P2P File Sharing';

    constructor(
        private languageService: LanguageService,
        private adService: AdService,
    ) {}

    async ngOnInit(): Promise<void> {
        this.languageService.init();
        // Carica lo script AdSense una sola volta al boot.
        // Su Electron o utenti Premium il metodo è no-op.
        await this.adService.initialize();
    }
}
