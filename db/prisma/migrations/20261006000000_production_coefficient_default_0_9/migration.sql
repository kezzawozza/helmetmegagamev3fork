-- The production coefficient default drops from 0.93 to 0.9: a day's pay is
-- brought down about 10% rather than about 7%. Move any row still carrying the
-- old default so a game that has never touched the knob follows the new one.
ALTER TABLE "GameConfig" ALTER COLUMN "productionCoefficient" SET DEFAULT 0.9;
UPDATE "GameConfig" SET "productionCoefficient" = 0.9 WHERE "productionCoefficient" = 0.93;
