import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { PlatformService } from './platform.service';
import { environment } from '@environments/environment';

/**
 * Servizio per gestire la pubblicità.
 *
 * Logica per piattaforma:
 * - Electron : nessun banner, nessun interstitial (app Premium-only)
 * - Web Premium: nessun banner, nessun interstitial
 * - Web Free  : mostra placeholder HTML interstitial ogni N trasferimenti
 *               (in futuro: Google AdSense per banner e interstitial reali)
 */
@Injectable({
    providedIn: 'root'
})
export class AdService {
    private transferCount = 0;
    private readonly TRANSFERS_BETWEEN_ADS = 2;

    /** Controlla la visibilità dell'overlay interstitial web */
    showInterstitial = signal(false);
    private interstitialResolve: (() => void) | null = null;

    constructor(
        private supabase: SupabaseService,
        private platform: PlatformService,
    ) {}

    /**
     * Restituisce true se gli annunci sono attivi per la sessione corrente.
     * False su Electron, per utenti Premium, o se disabilitati da environment.
     */
    get adsEnabled(): boolean {
        if (this.platform.isElectron) return false;
        if (this.supabase.isPremium()) return false;
        if (!environment.admob?.enabled) return false;
        return true;
    }

    /**
     * Registra un trasferimento completato.
     * Se adsEnabled e raggiunta la soglia, mostra l'interstitial web.
     * Restituisce una Promise che si risolve quando l'ad è chiuso.
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
     * Mostra l'interstitial HTML (solo web free).
     * Restituisce una Promise che si risolve alla chiusura.
     */
    private showInterstitialAd(): Promise<void> {
        return new Promise(resolve => {
            this.interstitialResolve = resolve;
            this.showInterstitial.set(true);

            // Auto-close dopo 5 secondi
            setTimeout(() => this.closeInterstitial(), 5000);
        });
    }

    /** Chiude l'interstitial HTML e risolve la Promise pendente */
    closeInterstitial(): void {
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
