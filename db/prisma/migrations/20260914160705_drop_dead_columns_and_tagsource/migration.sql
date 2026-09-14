-- Postgres can't drop a single enum value in place, so TagSource is recreated
-- below. Everything else here is a plain column drop.

-- Character.missedMealStreak: the retired Disappointed track. Nothing reads
-- or writes it since 2026-09-06 (db/lib/moodPass.js handles it instead).
ALTER TABLE "Character" DROP COLUMN IF EXISTS "missedMealStreak";

-- Character.travelToLocationId / travelTurnId: the deferred-travel journey
-- columns, retired 2026-09-14 when every crossing started landing at once
-- (docs/systemdocs/MAP.md §3). db/lib/travelArrivalPass.js was their last
-- reader and is being removed alongside this migration.
ALTER TABLE "Character" DROP CONSTRAINT IF EXISTS "Character_travelToLocationId_fkey";
ALTER TABLE "Character" DROP COLUMN IF EXISTS "travelToLocationId";
ALTER TABLE "Character" DROP COLUMN IF EXISTS "travelTurnId";

-- Depot.turretTable: the GM-editable turret odds blob. db/lib/depotTurret.js
-- has returned one shipped table to every caller for a while now; nothing
-- reads the column.
ALTER TABLE "Depot" DROP COLUMN IF EXISTS "turretTable";

-- TagSource: drop DESIRE_REWARD, LEADER_GRANT, CONDITION. All three are
-- written nowhere; CharacterTag.source is the only column of this type, and
-- no live row should hold one of these values, but remap defensively before
-- the type swap so the ALTER COLUMN ... USING cast below can't fail on a
-- stray row. GM_GRANT is the most neutral surviving value — every remapped
-- row was originally granted by a person or the game on the person's behalf,
-- never bought with points.
UPDATE "CharacterTag" SET "source" = 'GM_GRANT'
  WHERE "source" IN ('DESIRE_REWARD', 'LEADER_GRANT', 'CONDITION');

ALTER TYPE "TagSource" RENAME TO "TagSource_old";
CREATE TYPE "TagSource" AS ENUM (
  'POINT_BUY',
  'GM_GRANT',
  'EVENT',
  'LESSON',
  'CRAFT'
);
ALTER TABLE "CharacterTag" ALTER COLUMN "source" TYPE "TagSource"
  USING ("source"::text::"TagSource");
DROP TYPE "TagSource_old";
