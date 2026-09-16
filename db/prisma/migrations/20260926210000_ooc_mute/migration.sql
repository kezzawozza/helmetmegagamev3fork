-- A per-account OOC mute (db/lib/ooc.js). Additive only: a new table, no
-- column dropped and no row touched, so `migrate deploy` applies it with
-- nothing to lose.
CREATE TABLE "OocMute" (
    "discordUserId" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "byDiscordUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OocMute_pkey" PRIMARY KEY ("discordUserId")
);
