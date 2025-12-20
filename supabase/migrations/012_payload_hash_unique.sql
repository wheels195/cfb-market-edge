-- Add unique constraint on payload_hash for upsert support
-- This allows us to use ON CONFLICT for deduplication

ALTER TABLE odds_ticks ADD CONSTRAINT odds_ticks_payload_hash_unique UNIQUE (payload_hash);
