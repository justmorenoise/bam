import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SupabaseService } from '@core/services/supabase.service';

@Component({
    selector: 'app-callback',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="min-h-screen flex items-center justify-center">
            <div class="text-center">
                <div class="spinner mx-auto mb-4"></div>
                <h2 class="text-2xl font-black mb-2">Autenticazione in corso...</h2>
                <p class="text-slate-400">Verrai reindirizzato tra un attimo</p>
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
        }
    `]
})
export class CallbackComponent implements OnInit {
    constructor(
        private supabase: SupabaseService,
        private router: Router
    ) {
    }

    async ngOnInit() {
        // Wait for auth state to be ready
        await this.waitForAuth();

        // Redirect to dashboard
        this.router.navigate(['/dashboard'], { replaceUrl: true });
    }

    private async waitForAuth(): Promise<void> {
        // If already authenticated, return immediately
        if (this.supabase.isAuthenticated()) {
            return;
        }

        // Wait for session to be established (max 5 seconds)
        return new Promise((resolve) => {
            const maxAttempts = 50;
            let attempts = 0;

            const checkAuth = setInterval(() => {
                attempts++;

                if (this.supabase.isAuthenticated() || attempts >= maxAttempts) {
                    clearInterval(checkAuth);
                    resolve();
                }
            }, 100);
        });
    }
}
