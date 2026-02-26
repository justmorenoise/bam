import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdService } from '@core/services/ad.service';

/**
 * Overlay interstitial HTML (solo web free).
 *
 * - Electron : non renderizza nulla (app Premium-only)
 * - Web Free  : mostra overlay upsell Premium tra un trasferimento e l'altro
 * - Web Premium: non renderizza nulla
 *
 * Il gate viene controllato da adService.adsEnabled.
 */
@Component({
    selector: 'app-ad-interstitial',
    standalone: true,
    imports: [CommonModule, RouterLink],
    template: `
        @if (adService.adsEnabled && adService.showInterstitial()) {
            <div
                class="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
                (click)="adService.closeInterstitial()">

                <div
                    class="bg-slate-900 border border-slate-700 rounded-3xl p-8 max-w-md w-full text-center shadow-2xl relative"
                    (click)="$event.stopPropagation()">

                    <!-- Close button -->
                    <button
                        (click)="adService.closeInterstitial()"
                        class="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors text-sm font-bold">
                        &#10005;
                    </button>

                    <div class="text-5xl mb-4">&#128142;</div>
                    <h3 class="text-xl font-black text-white mb-2">Passa a Bam! Premium</h3>
                    <p class="text-sm text-slate-400 mb-6 leading-relaxed">
                        Condivisioni illimitate, crittografia con password,
                        URL personalizzati e zero pubblicità.
                    </p>

                    <div class="space-y-3">
                        <a
                            routerLink="/pricing"
                            (click)="adService.closeInterstitial()"
                            class="block w-full py-3 px-6 bg-gradient-to-r from-orange-600 to-red-600 text-white rounded-xl font-bold hover:shadow-lg hover:shadow-orange-500/30 transition-all">
                            Scopri i Piani
                        </a>
                        <button
                            (click)="adService.closeInterstitial()"
                            class="block w-full py-3 px-6 text-slate-500 hover:text-slate-300 text-sm transition-colors">
                            Continua gratis
                        </button>
                    </div>

                    <p class="text-[9px] text-slate-600 mt-4 uppercase tracking-widest">Sponsorizzato</p>
                </div>
            </div>
        }
    `,
})
export class AdInterstitialComponent {
    constructor(public adService: AdService) {}
}
