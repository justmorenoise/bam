import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SupabaseService } from '@core/services/supabase.service';

/**
 * Schermata mostrata agli utenti free che aprono l'app Electron.
 * L'app desktop è riservata esclusivamente agli utenti Premium.
 */
@Component({
    selector: 'app-electron-gate',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">

            <!-- Logo / Icona -->
            <div class="mb-8">
                <div class="w-20 h-20 bg-gradient-to-br from-orange-500 to-red-600 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-2xl shadow-orange-500/30">
                    <span class="text-4xl">&#128142;</span>
                </div>
                <h1 class="text-3xl font-black text-white tracking-tight">Bam! Desktop</h1>
                <p class="text-slate-400 text-sm mt-1">Disponibile per i membri Premium</p>
            </div>

            <!-- Card principale -->
            <div class="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl">

                <h2 class="text-xl font-bold text-white mb-3">
                    Sblocca l&apos;app desktop
                </h2>
                <p class="text-slate-400 text-sm leading-relaxed mb-6">
                    Bam! Desktop è riservato agli utenti
                    <span class="text-orange-400 font-semibold">Premium</span>.
                    Esegui l&apos;upgrade per accedere a trasferimenti illimitati,
                    crittografia avanzata e all&apos;app nativa per Mac, Windows e Linux.
                </p>

                <!-- Feature list -->
                <ul class="text-left space-y-2 mb-8">
                    @for (feature of features; track feature.label) {
                        <li class="flex items-center gap-3 text-sm text-slate-300">
                            <span class="text-green-400 text-base font-bold">✓</span>
                            {{ feature.label }}
                        </li>
                    }
                </ul>

                <!-- CTA -->
                <button
                    (click)="openPricing()"
                    class="w-full py-3.5 px-6 bg-gradient-to-r from-orange-600 to-red-600 text-white rounded-xl font-bold text-sm hover:shadow-lg hover:shadow-orange-500/30 hover:scale-[1.02] transition-all duration-200">
                    Scopri i Piani Premium &rarr;
                </button>

                <button
                    (click)="logout()"
                    class="w-full mt-3 py-2.5 px-6 text-slate-500 hover:text-slate-300 text-sm font-medium transition-colors">
                    Esci dall&apos;account
                </button>
            </div>

            <!-- Footer -->
            <p class="text-slate-600 text-xs mt-8">
                Hai già Premium?
                <button (click)="refresh()" class="text-slate-400 hover:text-white underline transition-colors ml-1">
                    Aggiorna stato account
                </button>
            </p>

        </div>
    `,
})
export class ElectronGateComponent {
    readonly features = [
        { label: 'App desktop nativa (Mac, Windows, Linux)' },
        { label: 'Trasferimenti illimitati senza limiti giornalieri' },
        { label: 'Crittografia avanzata con password' },
        { label: 'URL personalizzati per i tuoi link' },
        { label: 'Zero pubblicità su tutte le piattaforme' },
        { label: 'Seeding in background dal tray' },
    ];

    constructor(
        private supabase: SupabaseService,
        private router: Router,
    ) {}

    /**
     * Apre la pagina pricing nel browser di sistema,
     * non nella WebView di Electron.
     * electron/main.js gestisce già window.open con shell.openExternal.
     */
    openPricing(): void {
        window.open('https://bam.link/pricing', '_blank');
    }

    async logout(): Promise<void> {
        await this.supabase.signOut();
        this.router.navigate(['/auth/login']);
    }

    /**
     * Forza il refresh del profilo Supabase.
     * Se l'utente ha appena acquistato Premium, lo reindirizza alla dashboard.
     */
    async refresh(): Promise<void> {
        const userId = this.supabase.currentUser()?.id;
        if (!userId) return;

        const { data } = await this.supabase.supabase
            .from('user_profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (data) {
            this.supabase.currentProfile.set(data);
            if (data.tier === 'premium') {
                this.router.navigate(['/dashboard']);
            }
        }
    }
}
