-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "gameplayCategoryId" TEXT,
ADD COLUMN     "partyChannelId" TEXT;

-- CreateTable
CREATE TABLE "PartyThread" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "creatorCharacterId" TEXT NOT NULL,
    "currentLocationId" TEXT,
    "lastActivityTurn" INTEGER,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyThreadMember" (
    "partyThreadId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyThreadMember_pkey" PRIMARY KEY ("partyThreadId","characterId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartyThread_threadId_key" ON "PartyThread"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyThread_creatorCharacterId_key" ON "PartyThread"("creatorCharacterId");

-- CreateIndex
CREATE INDEX "PartyThread_currentLocationId_idx" ON "PartyThread"("currentLocationId");

-- CreateIndex
CREATE INDEX "PartyThreadMember_characterId_idx" ON "PartyThreadMember"("characterId");

-- AddForeignKey
ALTER TABLE "PartyThread" ADD CONSTRAINT "PartyThread_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyThreadMember" ADD CONSTRAINT "PartyThreadMember_partyThreadId_fkey" FOREIGN KEY ("partyThreadId") REFERENCES "PartyThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
