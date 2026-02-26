import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '@shared/components/header.component';
import { SupabaseService } from '@core/services/supabase.service';
import { ModalService } from '@core/services/modal.service';

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [CommonModule, FormsModule, HeaderComponent, RouterLink, TranslateModule],
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.css']
})
export class SettingsComponent {
    userProfile = this.supabase.currentProfile;

    fullName = signal('');
    isUpdatingProfile = signal(false);
    profileMessage = signal('');

    newPassword = signal('');
    confirmPassword = signal('');
    isUpdatingPassword = signal(false);
    passwordMessage = signal('');

    constructor(
        private supabase: SupabaseService,
        private router: Router,
        private modal: ModalService,
        private translate: TranslateService
    ) {
        this.fullName.set(this.userProfile()?.full_name || '');
    }

    async updateProfile() {
        if (!this.fullName().trim()) {
            this.profileMessage.set(this.translate.instant('SETTINGS.VALIDATION_NAME_EMPTY'));
            return;
        }

        this.isUpdatingProfile.set(true);
        this.profileMessage.set('');

        try {
            await this.supabase.updateProfile({
                full_name: this.fullName()
            });
            this.modal.showSuccess(
                this.translate.instant('SETTINGS.MODAL_SUCCESS_TITLE'),
                this.translate.instant('SETTINGS.MODAL_PROFILE_SUCCESS')
            );
            this.profileMessage.set('');
        } catch (error: any) {
            console.error('Error updating profile:', error);
            this.modal.showError(
                this.translate.instant('SETTINGS.MODAL_PROFILE_ERROR_TITLE'),
                this.translate.instant('SETTINGS.MODAL_PROFILE_ERROR_MSG')
            );
        } finally {
            this.isUpdatingProfile.set(false);
        }
    }

    async updatePassword() {
        if (!this.newPassword() || !this.confirmPassword()) {
            this.passwordMessage.set(this.translate.instant('SETTINGS.VALIDATION_FILL_FIELDS'));
            return;
        }

        if (this.newPassword() !== this.confirmPassword()) {
            this.passwordMessage.set(this.translate.instant('SETTINGS.VALIDATION_PASSWORDS_MATCH'));
            return;
        }

        if (this.newPassword().length < 6) {
            this.passwordMessage.set(this.translate.instant('SETTINGS.VALIDATION_PASSWORD_LENGTH'));
            return;
        }

        this.isUpdatingPassword.set(true);
        this.passwordMessage.set('');

        try {
            const { error } = await this.supabase.supabase.auth.updateUser({
                password: this.newPassword()
            });

            if (error) throw error;

            this.modal.showSuccess(
                this.translate.instant('SETTINGS.MODAL_SUCCESS_TITLE'),
                this.translate.instant('SETTINGS.MODAL_PASSWORD_SUCCESS')
            );
            this.newPassword.set('');
            this.confirmPassword.set('');
            this.passwordMessage.set('');
        } catch (error: any) {
            console.error('Error updating password:', error);
            this.modal.showError(
                this.translate.instant('SETTINGS.MODAL_ERROR_TITLE'),
                error.message || this.translate.instant('SETTINGS.VALIDATION_PASSWORD_LENGTH')
            );
        } finally {
            this.isUpdatingPassword.set(false);
        }
    }

    async logout() {
        try {
            await this.supabase.signOut();
            this.router.navigate(['/']);
        } catch (error) {
            console.error('Error signing out:', error);
        }
    }

    async deleteAccount() {
        const profile = this.userProfile();
        const level = Math.floor((profile?.xp_points || 0) / 100) + 1;

        this.modal.showDoubleConfirm(
            this.translate.instant('SETTINGS.MODAL_DELETE_TITLE'),
            this.translate.instant('SETTINGS.MODAL_DELETE_MSG', { level, xp: profile?.xp_points || 0 }),
            this.translate.instant('SETTINGS.MODAL_DELETE_CONFIRM'),
            this.translate.instant('SETTINGS.MODAL_DELETE_CONFIRM_BTN'),
            this.translate.instant('SETTINGS.MODAL_DELETE_CANCEL')
        ).subscribe(async (confirmed) => {
            if (confirmed) {
                try {
                    const userId = this.supabase.currentUser()?.id;
                    if (!userId) throw new Error('No user ID');

                    // Elimina profilo utente (CASCADE eliminerà anche file_transfers)
                    const { error: profileError } = await this.supabase.supabase
                        .from('user_profiles')
                        .delete()
                        .eq('id', userId);

                    if (profileError) throw profileError;

                    // Elimina utente da auth
                    const { error: authError } = await this.supabase.supabase.rpc('delete_user');
                    if (authError) {
                        console.warn('Auth deletion warning:', authError);
                    }

                    // Logout e redirect
                    await this.supabase.signOut();
                    this.modal.showSuccess(
                        this.translate.instant('SETTINGS.MODAL_DELETED_TITLE'),
                        this.translate.instant('SETTINGS.MODAL_DELETED_MSG')
                    );
                    setTimeout(() => {
                        this.router.navigate(['/']);
                    }, 2000);
                } catch (error: any) {
                    console.error('Error deleting account:', error);
                    this.modal.showError(
                        this.translate.instant('SETTINGS.MODAL_ERROR_TITLE'),
                        error.message
                    );
                }
            }
        });
    }
}
