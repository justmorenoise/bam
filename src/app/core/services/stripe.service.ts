import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface SubscriptionInfo {
    id: string;
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused';
    plan: 'monthly' | 'annual';
    price_id: string;
    current_period_start: string;
    current_period_end: string;
    trial_start: string | null;
    trial_end: string | null;
    cancel_at_period_end: boolean;
    canceled_at: string | null;
}

@Injectable({ providedIn: 'root' })
export class StripeService {
    private supabase = inject(SupabaseService);

    subscription = signal<SubscriptionInfo | null>(null);
    isLoadingCheckout = signal(false);
    isLoadingPortal = signal(false);

    isOnTrial = computed(() => this.subscription()?.status === 'trialing');
    trialEndsAt = computed(() => this.subscription()?.trial_end ?? null);
    renewsAt = computed(() => this.subscription()?.current_period_end ?? null);
    willCancel = computed(() => this.subscription()?.cancel_at_period_end ?? false);
    isActive = computed(() => {
        const status = this.subscription()?.status;
        return status === 'active' || status === 'trialing';
    });

    async loadSubscription(): Promise<void> {
        const { data, error } = await this.supabase.supabase
            .from('subscriptions')
            .select('*')
            .in('status', ['active', 'trialing', 'past_due'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('[StripeService] loadSubscription error:', error);
            return;
        }
        this.subscription.set(data as SubscriptionInfo | null);
    }

    private async getAuthHeader(): Promise<{ Authorization: string } | undefined> {
        const { data: { session } } = await this.supabase.supabase.auth.getSession();
        if (!session?.access_token) return undefined;
        return { Authorization: `Bearer ${session.access_token}` };
    }

    async startCheckout(plan: 'monthly' | 'annual'): Promise<void> {
        this.isLoadingCheckout.set(true);
        try {
            const headers = await this.getAuthHeader();
            const { data, error } = await this.supabase.supabase.functions.invoke('stripe-checkout', {
                body: { plan },
                headers,
            });

            if (error || !data?.url) {
                console.error('[StripeService] startCheckout error:', error ?? 'No URL returned');
                return;
            }
            window.location.href = data.url;
        } finally {
            this.isLoadingCheckout.set(false);
        }
    }

    async openPortal(): Promise<void> {
        this.isLoadingPortal.set(true);
        try {
            const headers = await this.getAuthHeader();
            const { data, error } = await this.supabase.supabase.functions.invoke('stripe-portal', {
                headers,
            });

            if (error || !data?.url) {
                console.error('[StripeService] openPortal error:', error ?? 'No URL returned');
                return;
            }
            window.location.href = data.url;
        } finally {
            this.isLoadingPortal.set(false);
        }
    }
}
