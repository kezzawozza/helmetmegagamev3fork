-- Room.soundproof: set from `soundproof: true` in docs/zones.yaml, read by
-- db/lib/shout.js#soundproofAt. Additive, defaults false, no backfill needed.
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "soundproof" BOOLEAN NOT NULL DEFAULT false;
