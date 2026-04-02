import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Lang, LanguageService, SUPPORTED_LANGS } from '@core/services/language.service';

@Component({
    selector: 'app-language-switcher',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="flex items-center gap-1">
            @for (lang of langs; track lang) {
                <button
                        (click)="setLang(lang)"
                        class="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors"
                        [class]="languageService.currentLang() === lang
                        ? 'bg-bam-primary text-white'
                        : 'text-slate-500 hover:text-slate-300'">
                    {{ lang }}
                </button>
            }
        </div>
    `
})
export class LanguageSwitcherComponent {
    readonly languageService = inject(LanguageService);
    readonly langs: Lang[] = [...SUPPORTED_LANGS];
    private readonly router = inject(Router);

    setLang(lang: Lang): void {
        this.languageService.setLanguage(lang);

        // Se la route corrente ha un prefisso lingua (/it/about, /en, ecc.)
        // naviga verso la stessa pagina con il nuovo prefisso
        const segments = this.router.url.split('?')[0].split('/').filter(Boolean);
        if (SUPPORTED_LANGS.includes(segments[0] as Lang)) {
            const pageParts = segments.slice(1); // rimuove il prefisso lingua corrente
            this.router.navigate(['/', lang, ...pageParts]);
        }
    }
}
