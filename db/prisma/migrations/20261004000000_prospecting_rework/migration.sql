-- The Prospecting rework (docs/systemdocs/MINING.md).
--
-- Two unrelated things, and they travel together only because they are one
-- change to the game:
--
--   1. The mining drop die is gone. Its whole config lived in
--      MiningDropOption, rebuilt wholesale from docs/miningdrops.yaml on every
--      sync run. Nothing ever pointed AT one of those rows -- no CharacterTag,
--      no Action foreign key -- so the table drops cleanly and takes its two
--      enums with it. What replaced it is a weighted draw in code
--      (db/lib/cavingLoot.js), beside the Caving Die's own table.
--
--      Action.appliedEffects rows written by the old die still carry a
--      `miningDrop` snapshot, which is JSON and needs no migration; the revert
--      arm in db/lib/moveEffects.js still understands the old RESOURCES shape.
--
--   2. Tag.gambitBonus arrives, for the Arkenstone. A Trinket forged with one
--      grants its holder +1 on the Gambit die; the column rides onto the
--      minted clone through db/lib/trinketPass.js and is read back by
--      db/lib/gambitModifier.js.
--
-- Authored by hand so `migrate deploy` applies it. `prisma migrate diff` would
-- also have proposed dropping ArchiveEntry_content_trgm_idx,
-- ThreatSpawn_pending_unique, AuditLog_details_trgm_idx,
-- DirectMessage_clientNonce_key and the six notify triggers -- decline all of
-- those, they are not drift (CLAUDE.md, Notes for future work).

ALTER TABLE "Tag" ADD COLUMN IF NOT EXISTS "gambitBonus" INTEGER;

-- Indexes go with the table, but named explicitly so a partially-applied run
-- is still re-runnable.
DROP INDEX IF EXISTS "MiningDropOption_roll_zoneId_locationId_idx";
DROP INDEX IF EXISTS "MiningDropOption_requiredTagId_idx";

DROP TABLE IF EXISTS "MiningDropOption";

DROP TYPE IF EXISTS "MiningDropRarity";
DROP TYPE IF EXISTS "MiningDropKind";
