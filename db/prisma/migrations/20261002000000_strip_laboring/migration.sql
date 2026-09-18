-- Laboring is gone. What a player did by filing a Labor is four buttons now —
-- Harvest Godflesh, Refine, Mine and Farm — and the only one of the four
-- specialised labor types left is mining. See docs/systemdocs/MINING.md.
--
-- Pre-launch: there is no live database behind this repo and no rows to
-- preserve, so the enum rebuilds below simply drop and recreate rather than
-- walking old values across. Written so `migrate deploy` applies it cleanly.

-- MoveKind: LABOR goes. ROUTINE stays as the kind the game files on a
-- player's behalf when a button spends their day.
ALTER TABLE "Action" ALTER COLUMN "moveKind" DROP DEFAULT;
UPDATE "Action" SET "moveKind" = 'ROUTINE' WHERE "moveKind" = 'LABOR';
ALTER TYPE "MoveKind" RENAME TO "MoveKind_old";
CREATE TYPE "MoveKind" AS ENUM ('GAMBIT', 'ROUTINE');
ALTER TABLE "Action" ALTER COLUMN "moveKind" TYPE "MoveKind" USING ("moveKind"::text::"MoveKind");
DROP TYPE "MoveKind_old";

-- The tier a Labor resolved at. One skill, no ladder, so nothing to stamp.
ALTER TABLE "Action" DROP COLUMN IF EXISTS "laborTier";

-- JoblessRole: Commoner goes with Laboring, Migrant becomes the default
-- overflow seat.
ALTER TABLE "PlayerPreference" ALTER COLUMN "joblessRole" DROP DEFAULT;
UPDATE "PlayerPreference" SET "joblessRole" = 'MIGRANT' WHERE "joblessRole" = 'COMMONER';
ALTER TYPE "JoblessRole" RENAME TO "JoblessRole_old";
CREATE TYPE "JoblessRole" AS ENUM ('MIGRANT', 'RETURN_TO_LOBBY');
ALTER TABLE "PlayerPreference" ALTER COLUMN "joblessRole" TYPE "JoblessRole" USING ("joblessRole"::text::"JoblessRole");
ALTER TABLE "PlayerPreference" ALTER COLUMN "joblessRole" SET DEFAULT 'MIGRANT';
DROP TYPE "JoblessRole_old";

-- LocationYield -> LocationMining: one coefficient per Location instead of
-- one per (Location, labor kind).
DROP TABLE IF EXISTS "LocationYield";
DROP TYPE IF EXISTS "LaborKind";

CREATE TABLE "LocationMining" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "base" DOUBLE PRECISION NOT NULL,
    "current" DOUBLE PRECISION NOT NULL,
    "eventTarget" DOUBLE PRECISION,
    "eventUntilTurn" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationMining_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LocationMining_locationId_key" ON "LocationMining"("locationId");
ALTER TABLE "LocationMining" ADD CONSTRAINT "LocationMining_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- LaborDropOption -> MiningDropOption. Pure config, rebuilt from
-- docs/miningdrops.yaml on every sync, so it is dropped rather than migrated.
DROP TABLE IF EXISTS "LaborDropOption";
DROP TYPE IF EXISTS "LaborDropLaborType";
DROP TYPE IF EXISTS "LaborDropKind";
DROP TYPE IF EXISTS "LaborDropRarity";

CREATE TYPE "MiningDropKind" AS ENUM ('TAG', 'RESOURCES', 'NOTHING');
CREATE TYPE "MiningDropRarity" AS ENUM ('ULTRACOMMON', 'COMMON', 'UNCOMMON', 'RARE', 'EXTREMELY_RARE', 'NEARLY_IMPOSSIBLE');

CREATE TABLE "MiningDropOption" (
    "id" TEXT NOT NULL,
    "roll" INTEGER NOT NULL,
    "zoneId" TEXT,
    "locationId" TEXT,
    "kind" "MiningDropKind" NOT NULL,
    "rarity" "MiningDropRarity",
    "tagId" TEXT,
    "resourceAmount" INTEGER,
    "requiredTagId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MiningDropOption_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MiningDropOption_roll_zoneId_locationId_idx" ON "MiningDropOption"("roll", "zoneId", "locationId");
CREATE INDEX "MiningDropOption_requiredTagId_idx" ON "MiningDropOption"("requiredTagId");
ALTER TABLE "MiningDropOption" ADD CONSTRAINT "MiningDropOption_zoneId_fkey"
    FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MiningDropOption" ADD CONSTRAINT "MiningDropOption_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MiningDropOption" ADD CONSTRAINT "MiningDropOption_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MiningDropOption" ADD CONSTRAINT "MiningDropOption_requiredTagId_fkey"
    FOREIGN KEY ("requiredTagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A tag's tool bonus is a mining bonus now, and carries no `kind`.
ALTER TABLE "Tag" RENAME COLUMN "laborBonus" TO "miningBonus";
UPDATE "Tag" SET "miningBonus" = "miningBonus" - 'kind' WHERE "miningBonus" IS NOT NULL;

-- Harvest Godflesh is once a TURN now, not once an in-game day (a day is two
-- turns), so the claim token holds a turn id and is named for it.
ALTER TABLE "Character" RENAME COLUMN "extractDayKey" TO "extractTurnKey";
