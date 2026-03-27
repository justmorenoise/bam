import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { SupabaseService } from '@core/services/supabase.service';

@Component({
    selector: 'app-forgot-password',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, TranslateModule],
    templateUrl: './forgot-password.component.html',
})
export class ForgotPasswordComponent {
    email = signal('');
    isLoading = signal(false);
    isSent = signal(false);

    constructor(private supabase: SupabaseService) {}

    async onSubmit() {
        if (!this.email().trim()) return;

        this.isLoading.set(true);
        try {
            await this.supabase.resetPassword(this.email());
        } catch (error) {
            console.error('Password reset request error:', error);
        } finally {
            this.isLoading.set(false);
            this.isSent.set(true);
        }
    }
}
