import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { StripeService } from '@core/services/stripe.service';
import { SupabaseService } from '@core/services/supabase.service';

@Component({
    selector: 'app-ad-premium-banner',
    imports: [
        TranslatePipe
    ],
    templateUrl: './ad-premium-banner.html',
    styleUrl: './ad-premium-banner.css',
})
export class AdPremiumBanner {
    private stripe = inject(StripeService);
    private supabase = inject(SupabaseService);
    private router = inject(Router);
    isLoading = this.stripe.isLoadingCheckout;

    async upgradeToPremium() {
        if (!this.supabase.currentUser()) {
            this.router.navigate(['/auth/register']);
            return;
        }
        await this.stripe.startCheckout('monthly');
    }
}
