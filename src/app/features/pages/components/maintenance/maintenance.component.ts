import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-maintenance',
    standalone: true,
    imports: [TranslateModule],
    template: `
        <div class="min-h-screen p-6 lg:p-10 flex flex-col items-center justify-center gap-10">

            <!-- Logo (same as header, larger) -->
            <div class="flex items-center gap-3">
                <div class="bg-bam-primary p-3 rounded-2xl shadow-lg shadow-bam-primary/20">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                         class="text-white">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                        <polyline points="16 6 12 2 8 6"/>
                        <line x1="12" y1="2" x2="12" y2="15"/>
                    </svg>
                </div>
                <span class="text-5xl font-black italic tracking-tighter uppercase">Bam!</span>
            </div>

            <!-- Card -->
            <div class="card max-w-md w-full text-center flex flex-col items-center gap-5">

                <!-- Flat icon -->
                <div class="text-bam-primary">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                </div>

                <h1 class="text-2xl font-black">{{ 'MAINTENANCE.TITLE' | translate }}</h1>

                <p class="text-sm text-slate-400 leading-relaxed"
                   [innerHTML]="'MAINTENANCE.DESC' | translate"></p>

                <!-- Status badge -->
                <div class="flex items-center gap-2 text-bam-warning text-sm
                            bg-bam-warning/10 border border-bam-warning/20 rounded-full px-4 py-2">
                    <span class="w-2 h-2 rounded-full bg-bam-warning animate-pulse"></span>
                    {{ 'MAINTENANCE.STATUS' | translate }}
                </div>
            </div>

            <footer class="text-xs text-slate-600">bamfile.com</footer>
        </div>
    `,
    styles: [],
})
export class MaintenanceComponent {}
