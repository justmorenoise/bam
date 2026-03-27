import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SupabaseService } from '@core/services/supabase.service';
import { ModalService } from '@core/services/modal.service';

@Component({
    selector: 'app-reset-password',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, TranslateModule],
    templateUrl: './reset-password.component.html',
})
export class ResetPasswordComponent implements OnInit {
    newPassword = signal('');
    confirmPassword = signal('');
    showNewPassword = signal(false);
    showConfirmPassword = signal(false);
    isLoading = signal(true);
    isInvalidLink = signal(false);
    errorMessage = signal('');

    constructor(
        private supabase: SupabaseService,
        private router: Router,
        private modal: ModalService,
        private translate: TranslateService
    ) {}

    async ngOnInit() {
        await this.supabase.authReady;
        if (!this.supabase.isAuthenticated()) {
            this.isInvalidLink.set(true);
        }
        this.isLoading.set(false);
    }

    async onSubmit() {
        this.errorMessage.set('');

        if (!this.newPassword() || !this.confirmPassword()) {
            this.errorMessage.set(this.translate.instant('AUTH.VALIDATION_FILL_ALL'));
            return;
        }

        if (this.newPassword() !== this.confirmPassword()) {
            this.errorMessage.set(this.translate.instant('AUTH.VALIDATION_PASSWORDS_MATCH'));
            return;
        }

        if (this.newPassword().length < 6) {
            this.errorMessage.set(this.translate.instant('AUTH.VALIDATION_PASSWORD_LENGTH'));
            return;
        }

        this.isLoading.set(true);
        try {
            const { error } = await this.supabase.supabase.auth.updateUser({
                password: this.newPassword()
            });
            if (error) throw error;

            this.modal.showSuccess(
                this.translate.instant('AUTH.MODAL_RESET_SUCCESS_TITLE'),
                this.translate.instant('AUTH.MODAL_RESET_SUCCESS_MSG')
            );
            await this.supabase.signOut();
            this.router.navigate(['/auth/login']);
        } catch (error: any) {
            console.error('Error resetting password:', error);
            this.modal.showError(
                this.translate.instant('AUTH.MODAL_LOGIN_ERROR_TITLE'),
                this.translate.instant('AUTH.MODAL_RESET_ERROR_MSG')
            );
        } finally {
            this.isLoading.set(false);
        }
    }
}
