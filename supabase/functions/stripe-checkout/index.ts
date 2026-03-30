import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createStripeClient, corsHeaders } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Autenticazione via JWT Supabase
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
                status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_ANON_KEY')!,
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (authError || !user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const { plan } = await req.json() as { plan: 'monthly' | 'annual' };
        if (!['monthly', 'annual'].includes(plan)) {
            return new Response(JSON.stringify({ error: 'Invalid plan' }), {
                status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const stripe = createStripeClient();
        const appUrl = Deno.env.get('APP_URL') ?? 'https://bamfile.com';

        // Recupera il profilo per ottenere email e stripe_customer_id esistente
        const { data: profile } = await supabaseClient
            .from('user_profiles')
            .select('stripe_customer_id, email, full_name')
            .eq('id', user.id)
            .single();

        // Controlla se esiste già una subscription attiva o in trial
        const { data: existingSub } = await supabaseClient
            .from('subscriptions')
            .select('id, status')
            .eq('user_id', user.id)
            .in('status', ['active', 'trialing'])
            .maybeSingle();

        if (existingSub) {
            return new Response(JSON.stringify({ error: 'Subscription already active' }), {
                status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Crea o recupera il Stripe Customer
        let stripeCustomerId = profile?.stripe_customer_id;
        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: profile?.email ?? user.email,
                name: profile?.full_name ?? undefined,
                metadata: { supabase_uid: user.id },
            });
            stripeCustomerId = customer.id;

            // Salva stripe_customer_id nel profilo (service role necessario per bypass trigger tier)
            const { createAdminClient } = await import('../_shared/stripe.ts');
            const adminClient = createAdminClient();
            await adminClient
                .from('user_profiles')
                .update({ stripe_customer_id: stripeCustomerId })
                .eq('id', user.id);
        }

        const priceId = plan === 'monthly'
            ? Deno.env.get('STRIPE_PRICE_MONTHLY')!
            : Deno.env.get('STRIPE_PRICE_ANNUAL')!;

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: stripeCustomerId,
            line_items: [{ price: priceId, quantity: 1 }],
            subscription_data: {
                trial_period_days: 7,
                metadata: { supabase_uid: user.id, plan },
            },
            success_url: `${appUrl}/settings?checkout=success`,
            cancel_url: `${appUrl}/pricing`,
            metadata: { supabase_uid: user.id, plan },
            allow_promotion_codes: true,
        });

        return new Response(JSON.stringify({ url: session.url }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (err) {
        console.error('[stripe-checkout] Error:', err);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
