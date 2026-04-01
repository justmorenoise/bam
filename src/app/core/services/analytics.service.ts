import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { environment } from '@environments/environment';

/**
 * Wrapper attorno a window.gtag() per GA4.
 *
 * - No-op completo in dev (gaId vuoto) e dove analytics.enabled = false.
 * - I page view vengono inviati automaticamente su NavigationEnd del Router (SPA-safe).
 * - Non gestisce il consenso: la CMP Google (Funding Choices / IAB TCF 2.x) aggiorna
 *   automaticamente analytics_storage/ad_storage tramite Consent Mode v2.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
    private readonly gaId   = environment.analytics?.gaId   ?? '';
    private readonly active = !!(environment.analytics?.enabled && this.gaId);

    constructor() {
        const router = inject(Router);
        const doc = inject(DOCUMENT);
        router.events
            .pipe(filter(e => e instanceof NavigationEnd))
            .subscribe((e: NavigationEnd) =>
                this.trackPageView(e.urlAfterRedirects, doc.title));

        if (this.active) {
            this.initWebVitals();
        }
    }

    /** Invia un hit page_view a GA4. */
    trackPageView(url: string, title: string): void {
        if (!this.active) return;
        this.gtag('event', 'page_view', { page_path: url, page_title: title });
    }

    /**
     * Invia un evento GA4 arbitrario.
     * @param name   Nome evento (snake_case raccomandato)
     * @param params Parametri aggiuntivi
     */
    trackEvent(name: string, params: Record<string, unknown> = {}): void {
        if (!this.active) return;
        this.gtag('event', name, params);
    }

    /**
     * Ritorna la categoria dimensionale di un file in base alla dimensione in byte.
     * Utile come parametro negli eventi upload/download.
     */
    fileSizeCategory(bytes: number): string {
        if (bytes < 1_000_000)     return '<1MB';
        if (bytes < 10_000_000)    return '1-10MB';
        if (bytes < 100_000_000)   return '10-100MB';
        if (bytes < 1_073_741_824) return '100MB-1GB';
        return '>1GB';
    }

    // ---- Private ----------------------------------------------------------------

    /** Carica web-vitals in modo lazy e invia CLS, INP, LCP, FCP, TTFB a GA4. */
    private initWebVitals(): void {
        import('web-vitals').then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
            const send = (m: { name: string; value: number; id: string }) =>
                this.gtag('event', m.name, {
                    // CLS: valore decimale → intero (×1000); altri: ms già interi
                    value:           Math.round(m.name === 'CLS' ? m.value * 1000 : m.value),
                    metric_id:       m.id,
                    non_interaction: true, // non influisce sul bounce rate
                });
            onCLS(send);
            onINP(send);
            onLCP(send);
            onFCP(send);
            onTTFB(send);
        });
    }

    /** Chiama window.gtag() in modo sicuro (SSR + adblocker safe). */
    private gtag(...args: unknown[]): void {
        if (typeof window === 'undefined') return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fn = (window as any)['gtag'];
        if (typeof fn === 'function') fn(...args);
    }
}
