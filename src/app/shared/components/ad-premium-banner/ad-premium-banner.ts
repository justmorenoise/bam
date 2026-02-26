import { Component } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { SupabaseService } from '@core/services/supabase.service';
import { ModalService } from '@core/services/modal.service';
import { Router } from '@angular/router';

@Component({
    selector: 'app-ad-premium-banner',
    imports: [
        TranslatePipe
    ],
    templateUrl: './ad-premium-banner.html',
    styleUrl: './ad-premium-banner.css',
})
export class AdPremiumBanner {
    constructor(
        private supabase: SupabaseService,
        private translate: TranslateService
    ) {
    }

    async upgradeToPremium() {
        // TODO: Implement payment flow
        try {
            await this.supabase.upgradeToPremium();
            alert(this.translate.instant('DASHBOARD.UPGRADE_SUCCESS'));
        } catch (error) {
            console.error('Upgrade error:', error);
            alert(this.translate.instant('DASHBOARD.UPGRADE_ERROR'));
        }
    }
}
