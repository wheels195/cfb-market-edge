-- Add unique constraint on cfbd_game_id for historical sync
-- This enables upsert on cfbd_game_id for historical game imports

-- First, clean up any duplicates if they exist
DELETE FROM events e1
WHERE e1.cfbd_game_id IS NOT NULL
AND EXISTS (
    SELECT 1 FROM events e2
    WHERE e2.cfbd_game_id = e1.cfbd_game_id
    AND e2.created_at > e1.created_at
);

-- Add unique index for cfbd_game_id (allowing nulls)
CREATE UNIQUE INDEX idx_events_cfbd_game_id ON events(cfbd_game_id) WHERE cfbd_game_id IS NOT NULL;
