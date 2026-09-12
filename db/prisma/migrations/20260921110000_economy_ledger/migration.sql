-- The economy ledger, behind /gm/economy.
--
-- Purely ADDITIVE: two new tables and two new enums, nothing altered and
-- nothing dropped. No backfill here — db:backfill-economy reconstructs what it
-- can from AuditLog afterwards, and writes one PLUG row per account for the
-- part it cannot.
--
-- EconomyEntry is a LOG TABLE, so the party ends are snapshot columns rather
-- than foreign keys (the ARCHITECTURE.md rule): a character dies and a Room is
-- pruned by a zone re-sync, and the book still has to read. gameId is a plain
-- column for the same reason plus one more — the archive-or-discard wipe
-- decides what happens to a finished game's books, and a cascade here would
-- make that decision for it.

CREATE TYPE "EconomyForm" AS ENUM ('BALANCE', 'COIN', 'ACCOUNT', 'DEBT', 'MANIFEST', 'GOODS');
CREATE TYPE "EconomySource" AS ENUM ('LIVE', 'BACKFILL', 'PLUG');

CREATE TABLE "EconomyEntry" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "turnId" TEXT,
    "turnNumber" INTEGER,
    "fromKind" TEXT,
    "fromId" TEXT,
    "fromName" TEXT,
    "toKind" TEXT,
    "toId" TEXT,
    "toName" TEXT,
    "form" "EconomyForm" NOT NULL,
    "amount" INTEGER NOT NULL,
    "tagId" TEXT,
    "tagSlug" TEXT,
    "quantity" INTEGER,
    "unitValue" INTEGER,
    "reason" TEXT NOT NULL,
    "actionType" TEXT,
    "auditLogId" TEXT,
    "actorDiscordUserId" TEXT,
    "zoneId" TEXT,
    "zoneName" TEXT,
    "locationId" TEXT,
    "roomId" TEXT,
    "secret" BOOLEAN NOT NULL DEFAULT false,
    "source" "EconomySource" NOT NULL DEFAULT 'LIVE',
    "backfillKey" TEXT,

    CONSTRAINT "EconomyEntry_pkey" PRIMARY KEY ("id")
);


CREATE INDEX "EconomyEntry_gameId_turnNumber_idx" ON "EconomyEntry"("gameId", "turnNumber");

CREATE INDEX "EconomyEntry_gameId_at_idx" ON "EconomyEntry"("gameId", "at");

CREATE INDEX "EconomyEntry_reason_at_idx" ON "EconomyEntry"("reason", "at");

CREATE INDEX "EconomyEntry_fromKind_fromId_at_idx" ON "EconomyEntry"("fromKind", "fromId", "at");

CREATE INDEX "EconomyEntry_toKind_toId_at_idx" ON "EconomyEntry"("toKind", "toId", "at");

CREATE INDEX "EconomyEntry_zoneName_at_idx" ON "EconomyEntry"("zoneName", "at");

CREATE INDEX "EconomyEntry_auditLogId_idx" ON "EconomyEntry"("auditLogId");

-- The reader's own predicates. The set above indexes the columns the writer
-- fills; these index the ones /gm/economy actually filters and sorts on —
-- reconcile() on form, the ledger chips and Health's UNATTRIBUTED group on
-- (gameId, reason), the zone-scoped ledger on (gameId, zoneId), and Health's
-- plug list on amount within a source, which nothing touched at all.
CREATE INDEX "EconomyEntry_gameId_form_idx" ON "EconomyEntry"("gameId", "form");
CREATE INDEX "EconomyEntry_gameId_reason_at_idx" ON "EconomyEntry"("gameId", "reason", "at");
CREATE INDEX "EconomyEntry_gameId_zoneId_idx" ON "EconomyEntry"("gameId", "zoneId");
CREATE INDEX "EconomyEntry_gameId_source_amount_idx" ON "EconomyEntry"("gameId", "source", "amount");



-- Backfill idempotency. PARTIAL, because backfillKey is null for every live
-- write and only db:backfill-economy sets it (as `<auditLogId>:<n>`) — a plain
-- unique would let exactly one live row exist. Prisma's schema language cannot
-- express a partial unique index, so like FactionApplication_pending_unique and
-- the others in CLAUDE.md this lives only here: `prisma migrate diff` will
-- propose dropping it. Decline that. Without it, re-running the backfill
-- doubles every reconstructed entry.
CREATE UNIQUE INDEX "EconomyEntry_backfillKey_unique"
  ON "EconomyEntry"("backfillKey") WHERE "backfillKey" IS NOT NULL;
