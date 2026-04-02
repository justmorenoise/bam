import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap, catchError, tap } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '@shared/components/header.component';
import { LanguageService } from '@core/services/language.service';
import { SeoService } from '@core/services/seo.service';
import { AnalyticsService } from '@core/services/analytics.service';
import { SupabaseService } from '@core/services/supabase.service';
import { StripeService } from '@core/services/stripe.service';

interface PricingData {
    plans: {
        name: string;
        subtitle: string;
        price: string;
        period: string;
        highlight: boolean;
        planKey?: 'monthly' | 'annual';
        savingsBadge?: string;
        anonymous?: boolean;
        features: { text: string; included: boolean }[];
    }[];
    faqs: { question: string; answer: string }[];
}

const EMPTY: PricingData = { plans: [], faqs: [] };

@Component({
    selector: 'app-pricing',
    standalone: true,
    imports: [CommonModule, RouterLink, HeaderComponent, TranslateModule],
    templateUrl: './pricing.component.html',
    styleUrls: ['./pricing.component.css']
})
export class PricingComponent {
    private http      = inject(HttpClient);
    private lang      = inject(LanguageService);
    private seo       = inject(SeoService);
    private analytics = inject(AnalyticsService);
    private supabase  = inject(SupabaseService);
    private stripe    = inject(StripeService);
    private router    = inject(Router);

    isLoadingCheckout = this.stripe.isLoadingCheckout;
    billingPeriod = signal<'monthly' | 'annual'>('monthly');
    visiblePlans = computed(() => {
        const period = this.billingPeriod();
        return this.data().plans.filter(p => !p.planKey || p.planKey === period);
    });

    onPricingCtaClick(planName: string, highlight: boolean): void {
        this.analytics.trackEvent('pricing_cta_clicked', {
            plan: planName,
            highlight,
        });
    }

    async onUpgradeClick(planKey: 'monthly' | 'annual'): Promise<void> {
        if (!this.supabase.currentUser()) {
            this.router.navigate(['/auth/register'], { queryParams: { next: 'pricing' } });
            return;
        }
        await this.stripe.startCheckout(planKey);
    }

    data = toSignal(
        toObservable(this.lang.currentLang).pipe(
            tap(() => this.seo.set('SEO.PRICING.TITLE', 'SEO.PRICING.DESC', 'pricing')),
            switchMap(lang =>
                this.http.get<PricingData>(`/assets/data/pricing/${lang}.json`).pipe(
                    catchError(() => this.http.get<PricingData>('/assets/data/pricing/en.json'))
                )
            )
        ),
        { initialValue: EMPTY }
    );
}
