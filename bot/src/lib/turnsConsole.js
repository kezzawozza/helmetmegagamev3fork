const { prisma } = require("@lifeweb/db");
const { postTurnsConsole } = require("@lifeweb/db/lib/turnAnnouncement");
const {
  isTurnsChannel,
  syncTurnsChannelAccess,
} = require("@lifeweb/db/lib/turnsChannelAccess");
const { CONSOLE_TEXT } = require("@lifeweb/db/lib/turnsConsoleRow");
const { buildTurnAnnouncement } = require("@lifeweb/db/turnCalendar");
const { clockFrozen, readGameState } = require("@lifeweb/db/lib/gameState");

// #turns is one rolling message — announcement, turn banner and the
// Move/Travel buttons — that db/lib/turnAnnouncement.js replaces every turn.
// This file is only the COLD START: at ready, make sure that message exists
// at all. It normally does and this does nothing; it matters for a fresh
// guild that has never advanced a turn, and as the backstop for a failed
// repost. See finishGameWipe in web/app/(app)/gm/dev/actions.js for Restart
// Game's own repost.

// Re-asserts who can see and speak in #turns (db/lib/turnsChannelAccess.js)
// and makes sure the console message exists, reusing it across restarts.
async function ensureTurnsConsole(guild) {
  const channel = [...guild.channels.cache.values()].find(isTurnsChannel);
  if (!channel) {
    console.error('Turns console: no text channel named "turns" in', guild.name);
    return;
  }

  await syncTurnsChannelAccess(prisma, { channelId: channel.id }).catch((err) => {
    console.error("Turns console: access sync failed:", err);
  });

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (config?.turnsConsoleChannelId === channel.id && config.turnsConsoleMessageId) {
    const existing = await channel.messages.fetch(config.turnsConsoleMessageId).catch(() => null);
    if (existing) return;
  }

  // Nothing tracked, or the tracked message is gone: repost against the open
  // turn with its own banner (Turn.banner, not a fresh pick — db/lib/turnBanner.js).
  const [openTurn, frozen, state] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" }, orderBy: { number: "desc" } }),
    clockFrozen(prisma),
    readGameState(prisma, {
      game: { select: { nukeDetonatedTurn: true, ascensionFiredTurn: true } },
    }),
  ]);
  const text = [
    openTurn ? buildTurnAnnouncement(openTurn, null, { clockFrozen: frozen }) : null,
    CONSOLE_TEXT,
  ]
    .filter(Boolean)
    .join("\n");

  await postTurnsConsole(prisma, channel.id, text, openTurn, config, state);
}

module.exports = { ensureTurnsConsole, isTurnsChannel };
