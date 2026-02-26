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
                    <app-language-switcher/>
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
