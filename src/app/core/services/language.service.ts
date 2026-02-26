import { Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export const SUPPORTED_LANGS = ['en', 'it'] as const;
export type Lang = typeof SUPPORTED_LANGS[number];
export const DEFAULT_LANG: Lang = 'en';

const STORAGE_KEY = 'bam_lang';

@Injectable({ providedIn: 'root' })
export class LanguageService {
    readonly currentLang = signal<Lang>(DEFAULT_LANG);

    constructor(private translate: TranslateService) {
    }

    init(): void {
        const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
        const lang: Lang = stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)
            ? (stored as Lang)
            : this.detectBrowserLang();
        this.setLanguage(lang);
    }

    setLanguage(lang: Lang): void {
        this.translate.use(lang);
        this.currentLang.set(lang);
        localStorage.setItem(STORAGE_KEY, lang);
    }

    private detectBrowserLang(): Lang {
        const browser = navigator.language?.substring(0, 2).toLowerCase();
        return (SUPPORTED_LANGS as readonly string[]).includes(browser) ? (browser as Lang) : DEFAULT_LANG;
    }
}
