import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { SupabaseService } from '@core/services/supabase.service';

@Component({
    selector: 'app-header',
    standalone: true,
    imports: [CommonModule, RouterLink, TranslateModule],
    template: `
        <header class="max-w-5xl mx-auto flex justify-between items-center mb-12">

            <div class="flex items-center gap-3 cursor-pointer group"
                 routerLink="/">

                <!-- hover controllato dal padre tramite group-hover -->
                <div class="bg-bam-primary p-2 rounded-xl shadow-lg shadow-bam-primary/20 group-hover:shadow-xl group-hover:shadow-orange-500/30 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                         class="text-white">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                        <polyline points="16 6 12 2 8 6"/>
                        <line x1="12" y1="2" x2="12" y2="15"/>
                    </svg>
                </div>

                <h1 class="text-2xl font-black italic tracking-tighter uppercase group-hover:text-bam-primary transition-colors">
                    Bam!
                </h1>
            </div>

            <div class="flex items-center gap-4">
                <div class="hidden md:block text-right">
                    <p class="text-[10px] font-black uppercase text-slate-500 tracking-widest">{{ 'HEADER.ACCOUNT_STATUS' | translate }}</p>
                    <p class="text-xs font-bold" [class.text-bam-primary]="!isPremium()">
                        {{ isPremium() ? ('HEADER.PREMIUM' | translate) : ('HEADER.FREE' | translate) }}
                    </p>
                </div>
                <button
                        routerLink="/auth/login"
                        class="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center hover:bg-slate-700 transition-colors">
                  <span
                          class="text-xs font-bold text-slate-400 block">
                    @if (userInitial()) {
                        {{ userInitial() }}
                    } @else {
                        <svg class="h-5" width="63" height="93" viewBox="0 0 63 93" fill="none"
                             xmlns="http://www.w3.org/2000/svg">
<path
        d="M50.5776 19.3264C50.5776 30.0001 41.9249 38.6528 31.2512 38.6528C20.5775 38.6528 11.9248 30.0001 11.9248 19.3264C11.9248 8.65273 20.5775 0 31.2512 0C41.9249 0 50.5776 8.65273 50.5776 19.3264Z"
        fill="#EA580C"/>
<path
        d="M0 62.4096C0 52.4685 8.05888 44.4096 18 44.4096H44.5024C54.4436 44.4096 62.5024 52.4685 62.5024 62.4096V92.5201H0V62.4096Z"
        fill="#EA580C"/>
</svg>

                    }
                  </span>
                </button>
            </div>
        </header>
    `,
    styles: []
})
export class HeaderComponent {
    supabase = inject(SupabaseService);
    isPremium = computed(() => this.supabase.currentProfile()?.tier === 'premium');
    userInitial = computed(() => this.supabase.currentUser()?.email?.charAt(0).toUpperCase() || undefined);
}
