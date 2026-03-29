-- Migration 004: Add missing R2/cloud columns and fix transfer_type constraint
-- Data: 2026-03-29
-- Descrizione: Aggiunge le colonne mancanti per il supporto R2 (burn streaming e cloud upload).
--              È sicura da eseguire più volte (idempotente).

-- 1. Aggiunge transfer_type se mancante (potrebbe essere stato aggiunto manualmente in alcuni ambienti)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'file_transfers' AND column_name = 'transfer_type'
    ) THEN
        ALTER TABLE file_transfers ADD COLUMN transfer_type TEXT NOT NULL DEFAULT 'p2p';
    END IF;
END $$;

-- 2. Aggiorna il constraint transfer_type per includere 'burn' (oltre a 'p2p' e 'cloud')
--    Il vecchio constraint potrebbe consentire solo ('p2p') o ('p2p', 'cloud'),
--    causando un errore di violazione del vincolo su ogni upload burn.
ALTER TABLE file_transfers DROP CONSTRAINT IF EXISTS file_transfers_transfer_type_check;
ALTER TABLE file_transfers ADD CONSTRAINT file_transfers_transfer_type_check
    CHECK (transfer_type IN ('p2p', 'cloud', 'burn'));

-- 3. Aggiunge retention_policy se mancante
ALTER TABLE file_transfers ADD COLUMN IF NOT EXISTS retention_policy TEXT;

-- 4. Aggiunge r2_token se mancante
ALTER TABLE file_transfers ADD COLUMN IF NOT EXISTS r2_token TEXT;

-- 5. Aggiunge custom_slug se mancante
ALTER TABLE file_transfers ADD COLUMN IF NOT EXISTS custom_slug TEXT;

-- 6. Crea indice univoco parziale su custom_slug (esclude NULL per compatibilità con più trasferimenti senza slug)
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_transfers_custom_slug
    ON file_transfers(custom_slug)
    WHERE custom_slug IS NOT NULL;

-- Commento sulle colonne
COMMENT ON COLUMN file_transfers.transfer_type IS 'Tipo di trasferimento: p2p (legacy WebRTC), burn (streaming R2), cloud (upload persistente premium)';
COMMENT ON COLUMN file_transfers.retention_policy IS 'Politica di conservazione: burn (elimina dopo download), 3day (3 giorni), permanent (permanente)';
COMMENT ON COLUMN file_transfers.r2_token IS 'Token UUID del file su Cloudflare R2';
COMMENT ON COLUMN file_transfers.custom_slug IS 'Slug personalizzato per il link (solo utenti premium)';
