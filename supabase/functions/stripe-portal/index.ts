import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createStripeClient, corsHeaders } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
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

        const { data: profile } = await supabaseClient
            .from('user_profiles')
            .select('stripe_customer_id')
            .eq('id', user.id)
            .single();

        if (!profile?.stripe_customer_id) {
            return new Response(JSON.stringify({ error: 'No Stripe customer found' }), {
                status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const stripe = createStripeClient();
        const appUrl = Deno.env.get('APP_URL') ?? 'https://bamfile.com';

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: `${appUrl}/settings`,
        });

        return new Response(JSON.stringify({ url: portalSession.url }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (err) {
        console.error('[stripe-portal] Error:', err);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
