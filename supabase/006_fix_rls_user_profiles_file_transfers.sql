-- Migration 006: Fix RLS su user_profiles e file_transfers
-- In preprod le migration 001 e 002 non avevano applicato RLS né le policy.
-- Questa migration è idempotente (usa IF NOT EXISTS dove possibile).

-- ========== user_profiles ==========
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ========== file_transfers ==========
ALTER TABLE file_transfers ENABLE ROW LEVEL SECURITY;

-- SELECT: proprietario (con soft delete da migration 002)
CREATE POLICY "Users can view their own non-deleted transfers"
  ON file_transfers FOR SELECT
  USING (
    (auth.uid() = sender_id OR (auth.uid() IS NULL AND sender_id IS NULL))
    AND deleted_at IS NULL
  );

-- SELECT: chiunque può vedere trasferimenti attivi tramite link_id
CREATE POLICY "Anyone can view active transfers by link_id"
  ON file_transfers FOR SELECT
  USING (status = 'active');

-- INSERT: utenti autenticati o anonimi
CREATE POLICY "Anyone can insert transfers"
  ON file_transfers FOR INSERT
  WITH CHECK (auth.uid() = sender_id OR (auth.uid() IS NULL AND sender_id IS NULL));

-- UPDATE: chiunque può aggiornare trasferimenti attivi (es. incremento download)
CREATE POLICY "Anyone can update transfers by link_id"
  ON file_transfers FOR UPDATE
  USING (status = 'active');

-- UPDATE: proprietario può fare soft delete
CREATE POLICY "Users can update their own transfers"
  ON file_transfers FOR UPDATE
  USING (auth.uid() = sender_id);
