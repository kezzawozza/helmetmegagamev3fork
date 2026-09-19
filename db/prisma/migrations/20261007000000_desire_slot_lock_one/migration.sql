-- Desire slots reopen a turn sooner: the lock drops from 2 turns to 1.
ALTER TABLE "GameConfig" ALTER COLUMN "desireSlotLockTurns" SET DEFAULT 1;
UPDATE "GameConfig" SET "desireSlotLockTurns" = 1 WHERE "desireSlotLockTurns" = 2;
