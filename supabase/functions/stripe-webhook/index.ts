import Stripe from 'npm:stripe@14';
import { createStripeClient, createAdminClient, resolveNewTier } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
    const signature = req.headers.get('stripe-signature');
    if (!signature) {
        return new Response('Missing stripe-signature header', { status: 400 });
    }

    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
        console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
        return new Response('Server configuration error', { status: 500 });
    }

    let event: Stripe.Event;
    try {
        const rawBody = await req.text();
        const stripe = createStripeClient();
        event = await stripe.webhooks.constructEventAsync(
            rawBody,
            signature,
            webhookSecret
        );
    } catch (err) {
        console.error('[stripe-webhook] Signature verification failed:', err);
        return new Response('Webhook signature verification failed', { status: 400 });
    }

    const supabaseAdmin = createAdminClient();

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                if (session.mode !== 'subscription') break;

                const supabaseUid = session.metadata?.supabase_uid;
                const plan = (session.metadata?.plan ?? 'monthly') as 'monthly' | 'annual';
                const subscriptionId = session.subscription as string;

                if (!supabaseUid || !subscriptionId) break;

                // Recupera i dettagli completi della subscription
                const stripe = createStripeClient();
                const sub = await stripe.subscriptions.retrieve(subscriptionId);

                await upsertSubscription(supabaseAdmin, supabaseUid, sub, plan);

                const tier = resolveNewTier(sub.status);
                await syncTier(supabaseAdmin, supabaseUid, tier);
                break;
            }

            case 'customer.subscription.updated': {
                const sub = event.data.object as Stripe.Subscription;
                const userId = await getUserIdByCustomer(supabaseAdmin, sub.customer as string);
                if (!userId) break;

                const plan = (sub.metadata?.plan ?? 'monthly') as 'monthly' | 'annual';
                await upsertSubscription(supabaseAdmin, userId, sub, plan);

                const tier = resolveNewTier(sub.status);
                await syncTier(supabaseAdmin, userId, tier);
                break;
            }

            case 'customer.subscription.deleted': {
                const sub = event.data.object as Stripe.Subscription;
                const userId = await getUserIdByCustomer(supabaseAdmin, sub.customer as string);
                if (!userId) break;

                await supabaseAdmin
                    .from('subscriptions')
                    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
                    .eq('id', sub.id);

                await syncTier(supabaseAdmin, userId, 'free');
                break;
            }

            case 'invoice.payment_succeeded': {
                const invoice = event.data.object as Stripe.Invoice;
                const subscriptionId = invoice.subscription as string;
                if (!subscriptionId) break;

                const stripe = createStripeClient();
                const sub = await stripe.subscriptions.retrieve(subscriptionId);
                const userId = await getUserIdByCustomer(supabaseAdmin, sub.customer as string);
                if (!userId) break;

                await supabaseAdmin
                    .from('subscriptions')
                    .update({
                        current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
                        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
                        status: sub.status,
                    })
                    .eq('id', sub.id);
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                const subscriptionId = invoice.subscription as string;
                if (!subscriptionId) break;

                const userId = await getUserIdBySubscription(supabaseAdmin, subscriptionId);
                if (!userId) break;

                await supabaseAdmin
                    .from('subscriptions')
                    .update({ status: 'past_due' })
                    .eq('id', subscriptionId);

                await syncTier(supabaseAdmin, userId, 'free');
                break;
            }

            default:
                console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
        }
    } catch (err) {
        console.error('[stripe-webhook] Error processing event:', event.type, err);
        // Ritorna 200 comunque per evitare che Stripe riprovi all'infinito
        return new Response(JSON.stringify({ received: true, error: 'Processing error' }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({ received: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
    });
});

// --- Helper functions ---

async function upsertSubscription(
    adminClient: ReturnType<typeof createAdminClient>,
    userId: string,
    sub: Stripe.Subscription,
    plan: 'monthly' | 'annual'
) {
    await adminClient.from('subscriptions').upsert({
        id: sub.id,
        user_id: userId,
        stripe_customer_id: sub.customer as string,
        status: sub.status,
        price_id: sub.items.data[0]?.price.id ?? '',
        plan,
        current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        trial_start: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
        trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        cancel_at_period_end: sub.cancel_at_period_end,
        canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    }, { onConflict: 'id' });
}

async function syncTier(
    adminClient: ReturnType<typeof createAdminClient>,
    userId: string,
    tier: 'free' | 'premium'
) {
    await adminClient
        .from('user_profiles')
        .update({ tier })
        .eq('id', userId);
}

async function getUserIdByCustomer(
    adminClient: ReturnType<typeof createAdminClient>,
    stripeCustomerId: string
): Promise<string | null> {
    const { data } = await adminClient
        .from('user_profiles')
        .select('id')
        .eq('stripe_customer_id', stripeCustomerId)
        .maybeSingle();
    return data?.id ?? null;
}

async function getUserIdBySubscription(
    adminClient: ReturnType<typeof createAdminClient>,
    subscriptionId: string
): Promise<string | null> {
    const { data } = await adminClient
        .from('subscriptions')
        .select('user_id')
        .eq('id', subscriptionId)
        .maybeSingle();
    return data?.user_id ?? null;
}
