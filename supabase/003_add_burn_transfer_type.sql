-- Migration 003: Add 'burn' to transfer_type constraint
-- The old 'p2p' type (WebRTC) is preserved for existing records.
-- New transfers use 'burn' (chunked R2 streaming) or 'cloud' (full upload, premium).

ALTER TABLE file_transfers
    DROP CONSTRAINT IF EXISTS file_transfers_transfer_type_check;

ALTER TABLE file_transfers
    ADD CONSTRAINT file_transfers_transfer_type_check
        CHECK (transfer_type IN ('p2p', 'cloud', 'burn'));
