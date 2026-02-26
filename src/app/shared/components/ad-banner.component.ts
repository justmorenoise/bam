import { Component, Input, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdService } from '@core/services/ad.service';
import { environment } from '@environments/environment';

/**
 * Banner pubblicitario AdSense per la versione web free.
 *
 * Comportamento per piattaforma:
 * - Electron  : non renderizza nulla
 * - Web Free  : slot AdSense reale (ins.adsbygoogle)
 * - Web Premium: non renderizza nulla
 *
 * Uso:
 *   <app-ad-banner position="dashboard" />
 *   <app-ad-banner position="upload" format="horizontal" />
 */
@Component({
    selector: 'app-ad-banner',
    standalone: true,
    imports: [CommonModule],
    template: `
        @if (adService.adsEnabled) {
            <div class="ad-banner-wrapper my-6">
                <!-- Label "Annuncio" richiesta da Google AdSense ToS -->
                <p class="text-[9px] text-slate-600 uppercase tracking-widest text-right mb-1 pr-1">Annuncio</p>

                <!-- Slot AdSense -->
                <ins
                    class="adsbygoogle"
                    style="display:block"
                    [attr.data-ad-client]="publisherId"
                    [attr.data-ad-slot]="bannerSlot"
                    [attr.data-ad-format]="adFormat"
                    data-full-width-responsive="true">
                </ins>
            </div>
        }
    `,
    styles: [`
        .ad-banner-wrapper {
            min-height: 90px; /* Riserva spazio per evitare layout shift */
            width: 100%;
        }
    `]
})
export class AdBannerComponent implements AfterViewInit, OnDestroy {
    /** Posizione del banner (influenza il formato) */
    @Input() position: 'dashboard' | 'landing' | 'upload' = 'dashboard';

    /**
     * Formato AdSense.
     * 'auto'       : adattivo responsive (default)
     * 'horizontal' : leaderboard
     * 'rectangle'  : medium rectangle
     */
    @Input() format: 'auto' | 'horizontal' | 'rectangle' = 'auto';

    readonly publisherId = environment.ads?.adsense?.publisherId ?? '';
    readonly bannerSlot  = environment.ads?.adsense?.bannerSlot ?? '';

    get adFormat(): string {
        return this.format;
    }

    constructor(public adService: AdService) {}

    ngAfterViewInit(): void {
        // Chiede ad AdSense di riempire lo slot dopo che il DOM è pronto
        this.adService.pushAd();
    }

    ngOnDestroy(): void {
        // AdSense gestisce internamente il cleanup degli slot
    }
}
