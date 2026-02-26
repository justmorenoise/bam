import { Injectable } from '@angular/core';

/**
 * Rileva la piattaforma di esecuzione dell'app.
 * - isElectron: l'app gira dentro Electron (desktop)
 * - isWeb: l'app gira nel browser
 */
@Injectable({
    providedIn: 'root'
})
export class PlatformService {
    /**
     * True se l'app è in esecuzione dentro Electron.
     * Verifica sia lo user agent sia la presenza del bridge IPC.
     */
    readonly isElectron: boolean =
        typeof navigator !== 'undefined' &&
        navigator.userAgent.toLowerCase().includes('electron');

    /**
     * True se l'app è in esecuzione nel browser web.
     */
    readonly isWeb: boolean = !this.isElectron;
}
