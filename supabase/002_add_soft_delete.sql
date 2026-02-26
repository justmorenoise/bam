-- Migration: Aggiunge soft delete ai trasferimenti
-- Data: 2026-02-12
-- Descrizione: Aggiunge campo deleted_at per eliminazione logica dei trasferimenti

-- 1. Aggiunge colonna deleted_at
ALTER TABLE file_transfers
ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- 2. Index per performance con soft delete (solo record attivi)
CREATE INDEX idx_file_transfers_deleted_at
ON file_transfers(deleted_at)
WHERE deleted_at IS NULL;

-- 3. Aggiorna RLS policy SELECT per escludere record eliminati
DROP POLICY IF EXISTS "Users can view their own transfers" ON file_transfers;

CREATE POLICY "Users can view their own non-deleted transfers"
  ON file_transfers FOR SELECT
  USING (
    (auth.uid() = sender_id OR (auth.uid() IS NULL AND sender_id IS NULL))
    AND deleted_at IS NULL
  );

-- 4. Policy per permettere UPDATE (soft delete) ai propri record
CREATE POLICY "Users can update their own transfers"
  ON file_transfers FOR UPDATE
  USING (auth.uid() = sender_id);

-- 5. Commento sulla colonna per documentazione
COMMENT ON COLUMN file_transfers.deleted_at IS 'Timestamp eliminazione logica. NULL = record attivo, NOT NULL = record eliminato';
