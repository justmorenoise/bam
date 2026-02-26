import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
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

    setLang(lang: Lang): void {
        this.languageService.setLanguage(lang);
    }
}
