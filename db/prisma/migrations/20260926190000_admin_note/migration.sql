-- GM-facing moderation notes about a PLAYER (discordUserId), replacing the
-- characterId-keyed GmCharacterNote dropped in 20260913030000. Additive only:
-- one new enum, one new table, nothing existing touched. No foreign keys by
-- design -- see the model comment in schema.prisma.

-- CreateEnum
CREATE TYPE "AdminNoteSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "AdminNote" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "authorDiscordUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "AdminNoteSeverity" NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminNote_discordUserId_createdAt_idx" ON "AdminNote"("discordUserId", "createdAt");
