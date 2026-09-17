-- Move the desk-side mute off ConversationMeta (desk-wide) onto a per-GM
-- row. Existing mutes are dropped: there is one live game and the mute is
-- an FYI, not load-bearing state.

ALTER TABLE "ConversationMeta" DROP COLUMN "mutedAt";

CREATE TABLE "ConversationMute" (
    "id" TEXT NOT NULL,
    "gmDiscordUserId" TEXT NOT NULL,
    "playerDiscordUserId" TEXT NOT NULL,
    "mutedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationMute_gmDiscordUserId_playerDiscordUserId_key" ON "ConversationMute"("gmDiscordUserId", "playerDiscordUserId");
CREATE INDEX "ConversationMute_playerDiscordUserId_idx" ON "ConversationMute"("playerDiscordUserId");
