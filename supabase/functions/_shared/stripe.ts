import Stripe from 'npm:stripe@14';
import { createClient } from 'jsr:@supabase/supabase-js@2';

export function createStripeClient(): Stripe {
    const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not set');
    return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

export function createAdminClient() {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    return createClient(url, key);
}

export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function resolveNewTier(status: string): 'free' | 'premium' {
    return ['active', 'trialing'].includes(status) ? 'premium' : 'free';
}
