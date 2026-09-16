-- The drawback point cap follows the starting budget back down to 8, restoring
-- the old symmetry: you can never claim back more than you started with. The
-- live row moves only if it is still on 12, so a hand-tuned number survives.
ALTER TABLE "GameConfig" ALTER COLUMN "maxDrawbackPoints" SET DEFAULT 8;
UPDATE "GameConfig" SET "maxDrawbackPoints" = 8 WHERE "maxDrawbackPoints" = 12;
