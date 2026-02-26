import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ModalService } from '@core/services/modal.service';

@Component({
    selector: 'app-modal',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslateModule],
    templateUrl: './modal.component.html',
    styleUrls: ['./modal.component.css']
})
export class ModalComponent {
    doubleConfirmInput = signal('');

    constructor(public modalService: ModalService) {
    }

    // Computed per verificare se doppia conferma è valida
    isDoubleConfirmValid = computed(() => {
        const config = this.modalService.modalState().config;
        if (!config?.requiresDoubleConfirm) return true;
        return this.doubleConfirmInput().trim().toUpperCase() === config.doubleConfirmText?.toUpperCase();
    });

    // Icona in base al tipo
    getIcon(): string {
        const type = this.modalService.modalState().config?.type;
        switch (type) {
            case 'success':
                return '✅';
            case 'error':
                return '❌';
            case 'warning':
                return '⚠️';
            case 'confirm':
                return '❓';
            case 'premium':
                return '';
            case 'info':
            default:
                return 'ℹ️';
        }
    }

    // Colore in base al tipo
    getColorClass(): string {
        const type = this.modalService.modalState().config?.type;
        switch (type) {
            case 'success':
                return 'text-green-600';
            case 'error':
                return 'text-red-600';
            case 'warning':
                return 'text-orange-600';
            case 'confirm':
                return 'text-blue-600';
            case 'info':
            default:
                return 'text-slate-600';
        }
    }

    // Chiudi modale se click su overlay
    onOverlayClick(event: MouseEvent): void {
        if (event.target === event.currentTarget) {
            this.modalService.cancel();
        }
    }

    // Conferma
    onConfirm(): void {
        const config = this.modalService.modalState().config;

        if (config?.type === 'confirm' || config?.type === 'premium') {
            if (config.requiresDoubleConfirm && !this.isDoubleConfirmValid()) {
                return;
            }
            this.modalService.confirm();
        } else {
            this.modalService.close();
        }

        // Reset input
        this.doubleConfirmInput.set('');
    }

    // Annulla
    onCancel(): void {
        this.modalService.cancel();
        this.doubleConfirmInput.set('');
    }
}
