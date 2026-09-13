-- Quests (docs/systemdocs/QUESTS.md): a piece of content a GM stages at
-- runtime, at any Location, without a YAML edit and without a deploy. It mints
-- one Room carrying a single Interact button, and pressing that button files
-- the presser's Move for the turn as a Gambit.
--
-- Room."questId" is the important column here. Every other Room in the game is
-- mastered by docs/zones.yaml, and db/lib/syncZones.js deletes any row whose
-- slug the YAML does not name. A quest room's slug is in no YAML, so without
-- this column the next sync would delete a live quest's thread and row. The
-- prune now skips rows where it is set.

-- CreateEnum
CREATE TYPE "QuestStatus" AS ENUM ('OPEN', 'CLOSED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Quest" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "QuestStatus" NOT NULL DEFAULT 'OPEN',
    "locationId" TEXT NOT NULL,
    "expiresTurn" INTEGER,
    "createdTurn" INTEGER,
    "createdById" TEXT,
    "accessTagSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedCharacterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Quest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestInteraction" (
    "id" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "intention" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quest_status_idx" ON "Quest"("status");

-- CreateIndex
CREATE INDEX "Quest_locationId_idx" ON "Quest"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestInteraction_actionId_key" ON "QuestInteraction"("actionId");

-- CreateIndex
CREATE INDEX "QuestInteraction_questId_idx" ON "QuestInteraction"("questId");

-- CreateIndex: one press per character per quest per turn. The one-Move-a-turn
-- rule in db/lib/moves.js already makes a second press impossible; this is the
-- database saying so too.
CREATE UNIQUE INDEX "QuestInteraction_questId_characterId_turnId_key" ON "QuestInteraction"("questId", "characterId", "turnId");

-- AlterTable: no existing Room was ever minted by a quest, so every row takes
-- the NULL default and the sync's behaviour for them is unchanged.
ALTER TABLE "Room" ADD COLUMN "questId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Room_questId_key" ON "Room"("questId");

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestInteraction" ADD CONSTRAINT "QuestInteraction_questId_fkey" FOREIGN KEY ("questId") REFERENCES "Quest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestInteraction" ADD CONSTRAINT "QuestInteraction_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: SetNull, because closing a quest deletes its Room while the
-- Quest row stays for the record.
ALTER TABLE "Room" ADD CONSTRAINT "Room_questId_fkey" FOREIGN KEY ("questId") REFERENCES "Quest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
