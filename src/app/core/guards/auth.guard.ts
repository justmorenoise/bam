import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { environment } from '@environments/environment';

export const maintenanceGuard = () => {
    const router = inject(Router);
    if (environment.maintenanceMode) {
        return router.createUrlTree(['/coming-soon']);
    }
    return true;
};

export const authGuard = async () => {
    const supabase = inject(SupabaseService);
    const router = inject(Router);

    await supabase.authReady;

    if (supabase.isAuthenticated()) {
        return true;
    }

    // Redirect to login
    return router.createUrlTree(['/auth/login']);
};

export const premiumGuard = async () => {
    const supabase = inject(SupabaseService);
    const router = inject(Router);

    await supabase.authReady;

    if (supabase.isAuthenticated() && supabase.isPremium()) {
        return true;
    }

    // Redirect to dashboard or upgrade page
    return router.createUrlTree(['/dashboard']);
};

/**
 * Guard per le route protette in Electron.
 * - Utente non autenticato → /auth/login
 * - Utente autenticato ma free → /electron-gate (pagina upsell)
 * - Utente premium → accesso consentito
 */
export const electronPremiumGuard = () => {
    // TODO: Electron non ancora implementato — guard disabilitato
    return true;
};
