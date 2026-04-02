import { PLATFORM_ID, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { LanguageService } from '../services/language.service';

/**
 * Guard che redirige le route bare (/about, /pricing, ecc.) alla versione
 * con prefisso lingua (/it/about, /en/about) in base alla preferenza dell'utente.
 * Sul server (prerender) non effettua il redirect — la route bare viene renderizzata normalmente.
 *
 * @param pagePath path della pagina (es. 'about') — stringa vuota per la home
 */
export const langRedirectGuard = (pagePath: string): CanActivateFn =>
    () => {
        if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
        const lang = inject(LanguageService).currentLang();
        const router = inject(Router);
        const segments: string[] = pagePath ? [lang, pagePath] : [lang];
        return router.createUrlTree(segments);
    };
