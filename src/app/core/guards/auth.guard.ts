import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { PlatformService } from '../services/platform.service';

export const authGuard = () => {
    const supabase = inject(SupabaseService);
    const router = inject(Router);

    if (supabase.isAuthenticated()) {
        return true;
    }

    // Redirect to login
    return router.createUrlTree(['/auth/login']);
};

export const premiumGuard = () => {
    const supabase = inject(SupabaseService);
    const router = inject(Router);

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
    const supabase = inject(SupabaseService);
    const platform = inject(PlatformService);
    const router = inject(Router);

    // Su web questo guard non deve mai bloccare
    if (!platform.isElectron) {
        return true;
    }

    if (!supabase.isAuthenticated()) {
        return router.createUrlTree(['/auth/login']);
    }

    if (!supabase.isPremium()) {
        return router.createUrlTree(['/electron-gate']);
    }

    return true;
};
