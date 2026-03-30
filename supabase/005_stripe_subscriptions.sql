-- Migration 005: Stripe Subscriptions
-- Aggiunge supporto per abbonamenti Stripe con tabella dedicata e protezione anti-tampering sul tier

-- 1. Aggiunge stripe_customer_id a user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

-- 2. Tabella subscriptions (source of truth per lo stato Stripe)
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   TEXT PRIMARY KEY,  -- Stripe subscription ID (sub_xxx)
  user_id              UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  stripe_customer_id   TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN (
    'active', 'trialing', 'past_due', 'canceled', 'unpaid',
    'incomplete', 'incomplete_expired', 'paused'
  )),
  price_id             TEXT NOT NULL,
  plan                 TEXT NOT NULL CHECK (plan IN ('monthly', 'annual')),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end   TIMESTAMPTZ NOT NULL,
  trial_start          TIMESTAMPTZ,
  trial_end            TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id   ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer  ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status    ON subscriptions(status);

-- Funzione updated_at (creata se non esiste già)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Trigger updated_at
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. RLS: gli utenti possono solo leggere la propria subscription; nessun write dal client
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- 4. Trigger anti-tampering: impedisce che il client modifichi direttamente user_profiles.tier
--    Solo le Edge Functions con service_role key possono cambiare il tier.
CREATE OR REPLACE FUNCTION prevent_tier_tampering()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.tier <> OLD.tier
     AND current_setting('request.jwt.claims', true)::jsonb->>'role' <> 'service_role' THEN
    RAISE EXCEPTION 'tier field can only be updated by the system';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_tier_immutability
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_tier_tampering();
