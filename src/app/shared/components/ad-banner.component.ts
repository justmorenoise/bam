import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdService } from '@core/services/ad.service';

/**
 * Componente banner pubblicitario.
 *
 * - Electron : non renderizza nulla (app Premium-only, zero banner)
 * - Web Free  : mostra placeholder HTML upsell Premium
 *               (in futuro sostituito con tag AdSense reale)
 * - Web Premium: non renderizza nulla
 */
@Component({
    selector: 'app-ad-banner',
    standalone: true,
    imports: [CommonModule],
    template: `
        @if (adService.adsEnabled) {
            <div class="ad-banner p-4 bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden relative group"
                 [ngClass]="{ 'mb-12': position === 'landing', 'mb-8': position === 'dashboard' }">
                <div class="absolute top-0 right-0 bg-slate-700 text-[8px] px-2 py-0.5 rounded-bl uppercase font-bold text-slate-400 tracking-widest">
                    Sponsorizzato
                </div>

                <div class="flex items-center gap-6">
                    <div class="w-24 h-24 bg-slate-700 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-slate-600 transition-colors">
                        <span class="text-3xl">&#127873;</span>
                    </div>
                    <div>
                        <h4 class="text-lg font-bold text-white mb-1">Passa a Bam! Premium</h4>
                        <p class="text-sm text-slate-400 mb-3">
                            Condivisioni illimitate, crittografia avanzata e zero pubblicità per sempre.
                        </p>
                        <button class="text-xs font-bold text-bam-primary uppercase tracking-wider hover:text-white transition-colors">
                            Scopri di più &rarr;
                        </button>
                    </div>
                </div>
            </div>
        }
    `,
    styles: [`
        .ad-banner {
            min-height: 120px;
        }
    `]
})
export class AdBannerComponent implements OnInit {
    @Input() position: 'dashboard' | 'landing' | 'upload' = 'dashboard';

    constructor(public adService: AdService) {
    }

    ngOnInit(): void {
        // Nessuna logica aggiuntiva necessaria:
        // adService.adsEnabled gestisce già tutti i casi (Electron, Premium, env flag)
    }
}
