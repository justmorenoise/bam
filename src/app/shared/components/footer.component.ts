import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { environment } from '@environments/environment';
import { LanguageSwitcherComponent } from '@shared/components/language-switcher/language-switcher.component';
import { SupabaseService } from '@core/services/supabase.service';

@Component({
    selector: 'app-footer',
    standalone: true,
    imports: [CommonModule, RouterLink, TranslateModule, LanguageSwitcherComponent],
    template: `
        <footer class="border-t border-slate-800 bg-slate-950/80 backdrop-blur-sm mt-auto">
            <div class="max-w-5xl mx-auto px-6 py-8 lg:px-10">
                <div class="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">

                    <!-- Brand -->
                    <div>
                        <a routerLink="/"
                           class="text-xl font-black italic uppercase text-bam-primary hover:text-bam-secondary transition-colors">Bam!</a>
                        <p class="text-xs text-slate-400 leading-relaxed mt-3">
                            {{ 'FOOTER.TAGLINE' | translate }}
                        </p>
                    </div>

                    <!-- Try -->
                    <div>
                        <h4 class="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">{{ 'FOOTER.TRY' | translate }}</h4>
                        <ul>
                            <li>
                                <a routerLink="/upload"
                                   class="text-xs text-slate-400 hover:text-bam-primary transition-colors inline-flex">{{ 'FOOTER.START_SHARING' | translate }}</a>
                            </li>
                            <li>
                                @if (hasUser()) {
                                    <a routerLink="/dashboard"
                                       class="text-xs text-slate-400 hover:text-bam-primary transition-colors inline-flex">{{ 'FOOTER.DASHBOARD' | translate }}</a>

                                } @else {
                                    <a routerLink="/auth/login"
                                       class="text-xs text-slate-400 hover:text-bam-primary transition-colors inline-flex">{{ 'FOOTER.LOGIN_OPTIONAL' | translate }}</a>
                                }
                            </li>
                        </ul>
                    </div>

                    <!-- Info -->
                    <div>
                        <h4 class="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">{{ 'FOOTER.INFO' | translate }}</h4>
                        <ul>
                            <li>
                                <a routerLink="/about"
                                   class="text-xs text-slate-400 hover:text-bam-primary transition-colors inline-flex">{{ 'FOOTER.ABOUT' | translate }}</a>
                            </li>
                            <li>
                                <a routerLink="/pricing"
                                   class="text-xs text-slate-400 hover:text-bam-primary transition-colors inline-flex">{{ 'FOOTER.PRICING' | translate }}</a>
                            </li>
                            <li>
                                <a routerLink="/security"
                                   class="text-xs text-slate-400 hover:text-bam-primary transition-colors inline-flex">{{ 'FOOTER.SECURITY' | translate }}</a>
                            </li>
                        </ul>
                    </div>

                    <!-- Legal -->
                    <div>
                        <h4 class="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">{{ 'FOOTER.LEGAL' | translate }}</h4>
                        <ul>
                            <li>
                                <a routerLink="/terms"
                                   class="text-xs text-slate-400 hover:text-bam-primary transition-colors inline-flex">{{ 'FOOTER.TERMS' | translate }}</a>
                            </li>
                            <li>
                                <a routerLink="/privacy"
                                   class="text-xs text-slate-400 hover:text-bam-primary transition-colors inline-flex">{{ 'FOOTER.PRIVACY' | translate }}</a>
                            </li>
                        </ul>
                    </div>
                </div>

                <!-- Bottom bar -->
                <div class="pt-8 border-t border-slate-800 flex flex-col md:flex-row justify-between items-center gap-4">
                    <p class="text-xs text-slate-500">{{ 'FOOTER.COPYRIGHT' | translate: { year: currentYear } }} {{ 'FOOTER.VERSION' | translate: { version: environment.version } }}</p>
                    <div class="flex flex-wrap items-center justify-center gap-4">
                        <!-- Made by Morenoise -->
                        <a href="https://morenoise.it" target="_blank" rel="noopener noreferrer"
                           class="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                            <span>{{ 'FOOTER.MADE_BY' | translate }}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="18" height="18" aria-label="Morenoise">
                                <!-- dot -->
                                <circle cx="17" cy="69" r="10" fill="#12B5C4"/>
                                <!-- left pill (teal) -->
                                <rect x="-13" y="-33" width="26" height="66" rx="13"
                                      transform="translate(43,49) rotate(10)" fill="#12B5C4"/>
                                <!-- overlap shadow: left pill clipped to right pill -->
                                <clipPath id="mn-rpc">
                                    <rect x="-13" y="-33" width="26" height="66" rx="13"
                                          transform="translate(66,49) rotate(5)"/>
                                </clipPath>
                                <rect x="-13" y="-33" width="26" height="66" rx="13"
                                      transform="translate(43,49) rotate(10)" fill="#0A7A8A"
                                      clip-path="url(#mn-rpc)"/>
                                <!-- right pill (dark navy) -->
                                <rect x="-13" y="-33" width="26" height="66" rx="13"
                                      transform="translate(66,49) rotate(5)" fill="#0D4E6F"/>
                            </svg>
                            <span class="font-medium">morenoise.it</span>
                        </a>
                        <!-- GitHub -->
                        <a href="https://github.com/justmorenoise/bam" target="_blank" rel="noopener noreferrer"
                           class="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                            </svg>
                            <span>{{ 'FOOTER.GITHUB' | translate }}</span>
                        </a>
                        <app-language-switcher/>
                    </div>
                </div>
            </div>
        </footer>
    `
})
export class FooterComponent {
    supabase = inject(SupabaseService);
    hasUser = computed(() => this.supabase.currentProfile()?.email !== undefined);

    currentYear = new Date().getFullYear();
    protected readonly environment = environment;
}
