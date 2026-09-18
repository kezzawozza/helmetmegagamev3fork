-- Factions and silos are removed outright. A silo was never its own table --
-- it was a pointer from Faction at a Room whose RoomTag stacks were the
-- treasury -- so dropping Faction takes the whole silo system with it. The
-- rooms themselves stay: they are ordinary stashes now.
--
-- Role.groupSlug (the migration before this one) is what replaced
-- Role.factionId. Character.isLeader/isTreasurer were the faction offices and
-- have no meaning without one. Document.factionSlugs and the "leader"/
-- "treasurer" flag values went the same way; nothing in docs/documents.yaml
-- uses either now.

-- FK holders first, so nothing blocks the table drops below.
ALTER TABLE "Character"
  DROP COLUMN IF EXISTS "factionId",
  DROP COLUMN IF EXISTS "isLeader",
  DROP COLUMN IF EXISTS "isTreasurer";

ALTER TABLE "Role"
  DROP COLUMN IF EXISTS "factionId",
  DROP COLUMN IF EXISTS "grantsLeader",
  DROP COLUMN IF EXISTS "grantsTreasurer";

ALTER TABLE "Document" DROP COLUMN IF EXISTS "factionSlugs";

-- Takes FactionApplication_pending_unique with it, which is why that index
-- leaves CLAUDE.md's list of drops to decline.
DROP TABLE IF EXISTS "FactionApplication";
DROP TABLE IF EXISTS "Faction";

DROP TYPE IF EXISTS "FactionApplicationKind";
DROP TYPE IF EXISTS "FactionApplicationStatus";
