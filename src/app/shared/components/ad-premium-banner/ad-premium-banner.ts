import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { StripeService } from '@core/services/stripe.service';

@Component({
    selector: 'app-ad-premium-banner',
    imports: [
        TranslatePipe
    ],
    templateUrl: './ad-premium-banner.html',
    styleUrl: './ad-premium-banner.css',
})
export class AdPremiumBanner {
    stripe = inject(StripeService);
    isLoading = this.stripe.isLoadingCheckout;

    async upgradeToPremium() {
        await this.stripe.startCheckout('monthly');
    }
}
