import { Injectable, signal, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SupabaseService } from './supabase.service';
import { PlatformService } from './platform.service';
import { AnalyticsService } from './analytics.service';
import { environment } from '@environments/environment';

/**
 * Servizio per gestire la pubblicità web via Google AdSense.
 *
 * Logica per piattaforma:
 * - Electron  : nessun annuncio (app Premium-only)
 * - Web Premium: nessun annuncio
 * - Web Free  : AdSense banner + interstitial upsell ogni N trasferimenti
 *
 * AdSense viene inizializzato lazy: lo script è caricato una sola volta
 * al primo accesso di un utente free su web.
 */
@Injectable({
    providedIn: 'root'
})
export class AdService {
    private readonly platformId = inject(PLATFORM_ID);
    private transferCount = 0;
    private readonly TRANSFERS_BETWEEN_ADS = 2;
    private adsenseLoaded = false;

    /** Controlla la visibilità dell'overlay interstitial upsell */
    showInterstitial = signal(false);
    private interstitialResolve: (() => void) | null = null;

    constructor(
        private supabase: SupabaseService,
        private platform: PlatformService,
        private analytics: AnalyticsService,
    ) {}

    /**
     * True se gli annunci sono attivi per la sessione corrente.
     * - False su Electron
     * - False per utenti Premium
     * - False se disabilitato da environment (development)
     */
    get adsEnabled(): boolean {
        if (this.platform.isElectron) return false;
        if (this.supabase.isPremium()) return false;
        if (!environment.ads?.enabled) return false;
        return true;
    }

    /**
     * Inizializza AdSense caricando lo script una sola volta.
     * Va chiamato da AppComponent.ngOnInit() solo su web free.
     * In development (enabled: false) non fa nulla.
     */
    async initialize(): Promise<void> {
        if (!isPlatformBrowser(this.platformId)) return;
        if (!this.adsEnabled || this.adsenseLoaded) return;

        // Script già caricato da index.html: non iniettarlo una seconda volta
        if ((window as any).adsbygoogle !== undefined) {
            this.adsenseLoaded = true;
            return;
        }

        // Fallback dinamico (nel caso index.html non carichi lo script)
        return new Promise<void>((resolve) => {
            const publisherId = environment.ads.adsense.publisherId;
            const script = document.createElement('script');
            script.async = true;
            script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}`;
            script.crossOrigin = 'anonymous';
            script.onload = () => {
                this.adsenseLoaded = true;
                resolve();
            };
            script.onerror = () => {
                // AdBlocker presente o rete non disponibile: fallback silenzioso
                console.warn('[AdService] AdSense script non caricato (AdBlocker?).');
                resolve();
            };
            document.head.appendChild(script);
        });
    }

    /**
     * Chiede ad AdSense di riempire tutti gli slot <ins> presenti nella pagina.
     * Va chiamato dopo ngAfterViewInit nei componenti che montano un banner.
     */
    pushAd(): void {
        if (!this.adsEnabled || !this.adsenseLoaded) return;
        try {
            ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
        } catch (e) {
            console.warn('[AdService] adsbygoogle.push fallito:', e);
        }
    }

    /**
     * Registra un trasferimento completato.
     * Se adsEnabled e raggiunta la soglia, mostra l'interstitial upsell.
     * Restituisce una Promise che si risolve alla chiusura dell'overlay.
     */
    async onTransferComplete(): Promise<void> {
        if (!this.adsEnabled) return;

        this.transferCount++;

        if (this.transferCount >= this.TRANSFERS_BETWEEN_ADS) {
            this.transferCount = 0;
            await this.showInterstitialAd();
        }
    }

    /**
     * Mostra l'interstitial upsell HTML.
     * Restituisce una Promise che si risolve alla chiusura.
     */
    private showInterstitialAd(): Promise<void> {
        return new Promise(resolve => {
            this.interstitialResolve = resolve;
            this.showInterstitial.set(true);
            this.analytics.trackEvent('ad_interstitial_shown');
            // Auto-close dopo 6 secondi
            setTimeout(() => this.closeInterstitial(), 6000);
        });
    }

    /** Chiude l'interstitial upsell e risolve la Promise pendente */
    closeInterstitial(): void {
        this.analytics.trackEvent('ad_interstitial_closed');
        this.showInterstitial.set(false);
        if (this.interstitialResolve) {
            this.interstitialResolve();
            this.interstitialResolve = null;
        }
    }

    /** Resetta il contatore (es. alla disconnessione) */
    resetCounter(): void {
        this.transferCount = 0;
    }
}
