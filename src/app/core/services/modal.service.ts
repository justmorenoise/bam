import { Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export type ModalType = 'info' | 'warning' | 'error' | 'success' | 'confirm' | 'premium';

export interface ModalConfig {
    title: string;
    message: string;
    type: ModalType;
    confirmText?: string;
    cancelText?: string;
    requiresDoubleConfirm?: boolean;
    doubleConfirmText?: string;
}

export interface ModalState {
    isOpen: boolean;
    config: ModalConfig | null;
}

@Injectable({
    providedIn: 'root'
})
export class ModalService {
    // Signal per stato modale
    modalState = signal<ModalState>({
        isOpen: false,
        config: null
    });

    // Subject per gestire risposte confirm
    private confirmSubject = new Subject<boolean>();

    /**
     * Mostra modale informativo
     */
    showInfo(title: string, message: string): void {
        this.show({
            title,
            message,
            type: 'info',
            confirmText: 'Chiudi'
        });
    }

    /**
     * Mostra modale di successo
     */
    showSuccess(title: string, message: string): void {
        this.show({
            title,
            message,
            type: 'success',
            confirmText: 'Chiudi'
        });
    }

    /**
     * Mostra modale di errore
     */
    showError(title: string, message: string): void {
        this.show({
            title,
            message,
            type: 'error',
            confirmText: 'Chiudi'
        });
    }

    /**
     * Mostra modale di warning
     */
    showWarning(title: string, message: string): void {
        this.show({
            title,
            message,
            type: 'warning',
            confirmText: 'Chiudi'
        });
    }

    /**
     * Mostra modale di conferma con Promise
     */
    showConfirm(
        title: string,
        message: string,
        confirmText: string = 'Conferma',
        cancelText: string = 'Annulla'
    ): Observable<boolean> {
        this.show({
            title,
            message,
            type: 'confirm',
            confirmText,
            cancelText
        });

        return this.confirmSubject.asObservable();
    }

    /**
     * Mostra modale di conferma con Promise
     */
    showPremium(
        title: string,
        message: string,
        confirmText: string = 'Vai ai piani',
        cancelText: string = 'Annulla'
    ): Observable<boolean> {
        this.show({
            title,
            message,
            type: 'premium',
            confirmText,
            cancelText
        });

        return this.confirmSubject.asObservable();
    }

    /**
     * Mostra modale con doppia conferma (es. eliminazione account)
     */
    showDoubleConfirm(
        title: string,
        message: string,
        doubleConfirmText: string,
        confirmText: string = 'Elimina',
        cancelText: string = 'Annulla'
    ): Observable<boolean> {
        this.show({
            title,
            message,
            type: 'confirm',
            confirmText,
            cancelText,
            requiresDoubleConfirm: true,
            doubleConfirmText
        });

        return this.confirmSubject.asObservable();
    }

    /**
     * Mostra modale con configurazione custom
     */
    private show(config: ModalConfig): void {
        this.modalState.set({
            isOpen: true,
            config
        });
    }

    /**
     * Chiude il modale
     */
    close(): void {
        this.modalState.set({
            isOpen: false,
            config: null
        });
    }

    /**
     * Conferma azione (per modali confirm)
     */
    confirm(): void {
        this.confirmSubject.next(true);
        this.close();
    }

    /**
     * Annulla azione (per modali confirm)
     */
    cancel(): void {
        this.confirmSubject.next(false);
        this.close();
    }
}
