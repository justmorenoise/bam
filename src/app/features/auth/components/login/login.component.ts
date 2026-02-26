import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SupabaseService } from '@core/services/supabase.service';
import { ModalService } from '@core/services/modal.service';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, TranslateModule],
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
    email = signal('');
    password = signal('');
    isLoading = signal(false);
    errorMessage = signal('');

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

    async onLogin() {
        if (!this.email() || !this.password()) {
            this.errorMessage.set(this.translate.instant('AUTH.VALIDATION_FILL_ALL'));
            return;
        }

        this.isLoading.set(true);
        this.errorMessage.set('');

        try {
            await this.supabase.signIn(this.email(), this.password());
            this.router.navigate(['/dashboard']);
        } catch (error: any) {
            console.error('Login error:', error);
            this.modal.showError(
                this.translate.instant('AUTH.MODAL_LOGIN_ERROR_TITLE'),
                error.message || this.translate.instant('AUTH.MODAL_LOGIN_ERROR_MSG')
            );
            this.errorMessage.set('');
        } finally {
            this.isLoading.set(false);
        }
    }

    async loginWithGoogle() {
        this.isLoading.set(true);
        this.errorMessage.set('');

        try {
            await this.supabase.signInWithGoogle();
        } catch (error: any) {
            console.error('Google login error:', error);
            this.errorMessage.set(this.translate.instant('AUTH.MODAL_GOOGLE_ERROR'));
            this.isLoading.set(false);
        }
    }
}
