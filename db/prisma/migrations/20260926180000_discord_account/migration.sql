-- The Discord handle behind an account, cached so a GM can search "peace.lock"
-- instead of a snowflake. Additive only: a new table, nothing existing touched.
-- See db/lib/discordAccounts.js and the model comment in schema.prisma.
-- CreateTable
CREATE TABLE "DiscordAccount" (
    "discordUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "globalName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordAccount_pkey" PRIMARY KEY ("discordUserId")
);

-- CreateIndex
CREATE INDEX "DiscordAccount_username_idx" ON "DiscordAccount"("username");
