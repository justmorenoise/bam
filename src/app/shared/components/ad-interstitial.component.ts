import { Component, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdService } from '@core/services/ad.service';
import { environment } from '@environments/environment';

/**
 * Overlay interstitial AdSense (solo web free).
 *
 * Mostra un banner AdSense rectangle (300×250) tra un trasferimento e l'altro.
 * L'overlay è chiudibile in qualsiasi momento (policy AdSense).
 * Auto-close dopo 6 secondi gestito da AdService.
 */
@Component({
    selector: 'app-ad-interstitial',
    standalone: true,
    imports: [CommonModule],
    template: `
        @if (adService.adsEnabled && adService.showInterstitial()) {
            <div class="fixed bottom-0 left-0 right-0 z-[9999] flex justify-center pb-4 pointer-events-none">
                <div class="bg-white rounded-xl shadow-2xl p-3 relative pointer-events-auto"
                     style="width:320px">

                    <!-- Close button — sempre visibile, richiesto da policy AdSense -->
                    <button
                        (click)="adService.closeInterstitial()"
                        class="absolute -top-3 -right-3 w-6 h-6 bg-slate-600 text-white rounded-full text-xs font-bold flex items-center justify-center shadow-md z-10">
                        &#10005;
                    </button>

                    <!-- Label richiesta da Google AdSense ToS -->
                    <p class="text-[9px] text-slate-400 uppercase tracking-widest text-right mb-1">Annuncio</p>

                    <!-- Slot AdSense rectangle 300×250 -->
                    <ins
                        class="adsbygoogle"
                        style="display:block;width:300px;height:250px"
                        [attr.data-ad-client]="publisherId"
                        [attr.data-ad-slot]="interstitialSlot">
                    </ins>
                </div>
            </div>
        }
    `,
})
export class AdInterstitialComponent {
    readonly publisherId = environment.ads?.adsense?.publisherId ?? '';
    readonly interstitialSlot = environment.ads?.adsense?.interstitialSlot ?? '';

    constructor(public adService: AdService) {
        // Chiama pushAd() dopo che Angular ha reso il DOM con l'<ins>
        effect(() => {
            if (adService.showInterstitial()) {
                setTimeout(() => adService.pushAd(), 0);
            }
        });
    }
}
