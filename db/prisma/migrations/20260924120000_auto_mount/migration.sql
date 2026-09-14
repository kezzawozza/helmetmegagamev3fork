-- The sheet's "Automatically ride my mount" switch (CARRY.md §3,
-- db/lib/indoors.js#takeUpMountsOutdoors). Off for everyone already playing:
-- nobody's horse moves until they ask.

ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "autoMount" BOOLEAN NOT NULL DEFAULT false;
