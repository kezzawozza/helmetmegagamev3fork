-- A Threats correspondent for the Oracle (docs/systemdocs/ORACLE.md): one more
-- zone-shaped page, scoped to antagonist seat-holders instead of a real Zone.
--
-- OracleSynopsis.zoneId = NULL used to mean exactly one thing: the front page,
-- enforced by OracleSynopsis_front_page_unique. A Threats page has no real
-- Zone row to point zoneId at, so it wants zoneId = NULL too -- which would
-- collide with the front page's own slot. `kind` is what tells them apart now.

-- CreateEnum
CREATE TYPE "OracleSynopsisKind" AS ENUM ('ZONE', 'FRONT', 'THREATS');

-- AlterTable: every existing row is a real zone page or the front page --
-- nothing was ever a Threats page before this migration, so the backfill
-- below is exhaustive.
ALTER TABLE "OracleSynopsis" ADD COLUMN "kind" "OracleSynopsisKind" NOT NULL DEFAULT 'ZONE';
UPDATE "OracleSynopsis" SET "kind" = 'FRONT' WHERE "zoneId" IS NULL;

-- The old partial index allowed only one zoneId-IS-NULL row per turn, which is
-- now two different things (FRONT and THREATS). Narrow it to FRONT rows only,
-- and add a sibling for THREATS. Same shape as ThreatSpawn_pending_unique and
-- FactionApplication_pending_unique: `prisma migrate diff` cannot express a
-- partial index, will propose dropping both, and the drop must be declined.
DROP INDEX "OracleSynopsis_front_page_unique";
CREATE UNIQUE INDEX "OracleSynopsis_front_page_unique" ON "OracleSynopsis"("turnId") WHERE "zoneId" IS NULL AND "kind" = 'FRONT';
CREATE UNIQUE INDEX "OracleSynopsis_threats_page_unique" ON "OracleSynopsis"("turnId") WHERE "kind" = 'THREATS';
