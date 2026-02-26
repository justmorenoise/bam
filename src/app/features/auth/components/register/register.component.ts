import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SupabaseService } from '@core/services/supabase.service';
import { ModalService } from '@core/services/modal.service';

@Component({
    selector: 'app-register',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, TranslateModule],
    templateUrl: './register.component.html',
    styleUrls: ['./register.component.css']
})
export class RegisterComponent implements OnInit {
    fullName = signal('');
    email = signal('');
    password = signal('');
    confirmPassword = signal('');
    isLoading = signal(false);
    errorMessage = signal('');
    successMessage = signal('');

    constructor(
        private supabase: SupabaseService,
        private router: Router,
        private modal: ModalService,
        private translate: TranslateService
    ) {
    }

    ngOnInit() {
        // If already authenticated, redirect immediately
        if (this.supabase.isAuthenticated()) {
            this.router.navigate(['/dashboard']);
        }
    }

    async onRegister() {
        // Validation
        if (!this.fullName() || !this.email() || !this.password() || !this.confirmPassword()) {
            this.errorMessage.set(this.translate.instant('AUTH.VALIDATION_FILL_ALL'));
            return;
        }

        if (this.password() !== this.confirmPassword()) {
            this.errorMessage.set(this.translate.instant('AUTH.VALIDATION_PASSWORDS_MATCH'));
            return;
        }

        if (this.password().length < 6) {
            this.errorMessage.set(this.translate.instant('AUTH.VALIDATION_PASSWORD_LENGTH'));
            return;
        }

        this.isLoading.set(true);
        this.errorMessage.set('');
        this.successMessage.set('');

        try {
            await this.supabase.signUp(
                this.email(),
                this.password(),
                this.fullName()
            );

            this.modal.showSuccess(
                this.translate.instant('AUTH.MODAL_REGISTER_SUCCESS_TITLE'),
                this.translate.instant('AUTH.MODAL_REGISTER_SUCCESS_MSG')
            );

            // Redirect to login after 3 seconds
            setTimeout(() => {
                this.router.navigate(['/auth/login']);
            }, 3000);
        } catch (error: any) {
            console.error('Registration error:', error);
            this.modal.showError(this.translate.instant('AUTH.MODAL_REGISTER_ERROR_TITLE'), error.message || 'Impossibile completare la registrazione');
            this.errorMessage.set('');
        } finally {
            this.isLoading.set(false);
        }
    }

    async registerWithGoogle() {
        this.isLoading.set(true);
        this.errorMessage.set('');

        try {
            await this.supabase.signInWithGoogle();
        } catch (error: any) {
            console.error('Google registration error:', error);
            this.modal.showError(
                this.translate.instant('AUTH.MODAL_REGISTER_ERROR_GOOGLE_TITLE'),
                this.translate.instant('AUTH.MODAL_REGISTER_ERROR_GOOGLE')
            );
            this.isLoading.set(false);
        }
    }
}
