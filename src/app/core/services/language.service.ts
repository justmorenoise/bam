import { Injectable, signal, PLATFORM_ID, inject } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';

export const SUPPORTED_LANGS = ['en', 'it'] as const;
export type Lang = typeof SUPPORTED_LANGS[number];
export const DEFAULT_LANG: Lang = 'en';

const STORAGE_KEY = 'bam_lang';

@Injectable({ providedIn: 'root' })
export class LanguageService {
    private readonly platformId = inject(PLATFORM_ID);
    private readonly document = inject(DOCUMENT);
    readonly currentLang = signal<Lang>(DEFAULT_LANG);
    private initialized = false;

    constructor(private translate: TranslateService) {
        // Init immediato: i guard vengono eseguiti prima di AppComponent.ngOnInit,
        // quindi il signal deve essere già corretto al momento della loro esecuzione.
        this.init();
    }

    init(): void {
        if (this.initialized) return;
        this.initialized = true;

        if (!isPlatformBrowser(this.platformId)) {
            this.translate.use(DEFAULT_LANG);
            return;
        }
        // Se la route ha un prefisso lingua (/en/... o /it/...) ha priorità
        const firstSegment = this.document.location.pathname.split('/').filter(Boolean)[0];
        if ((SUPPORTED_LANGS as readonly string[]).includes(firstSegment)) {
            this.setLanguage(firstSegment as Lang);
            return;
        }
        const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
        const lang: Lang = stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)
            ? (stored as Lang)
            : this.detectBrowserLang();
        this.setLanguage(lang);
    }

    setLanguage(lang: Lang): void {
        this.translate.use(lang);
        this.currentLang.set(lang);
        if (isPlatformBrowser(this.platformId)) {
            localStorage.setItem(STORAGE_KEY, lang);
        }
    }

    private detectBrowserLang(): Lang {
        const browser = navigator.language?.substring(0, 2).toLowerCase();
        return (SUPPORTED_LANGS as readonly string[]).includes(browser) ? (browser as Lang) : DEFAULT_LANG;
    }
}
