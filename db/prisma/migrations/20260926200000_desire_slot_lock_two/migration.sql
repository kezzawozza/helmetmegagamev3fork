-- The per-slot Desire lock goes from 1 turn to 2. It is the throttle on Desire
-- income, and at 1 the Tag Point tap ran faster than the economy wanted.

ALTER TABLE "GameConfig" ALTER COLUMN "desireSlotLockTurns" SET DEFAULT 2;

-- Changing the default leaves the live singleton row alone, so move it too.
-- The WHERE keeps a GM's deliberate setting (0 for debugging, or 3 and up)
-- from being stomped by this migration.
UPDATE "GameConfig" SET "desireSlotLockTurns" = 2 WHERE "desireSlotLockTurns" = 1;
