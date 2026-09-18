// REST-only turn announcement, called from db/index.js#advanceTurn() — the
// single implementation for both the bot's cron path and the web Dev
// Panel's manual "End Turn" button. Takes `prisma` as a parameter rather
// than `require("../index")`, since that would be a circular require
// resolving to a partial (prisma-less) exports object.
const fs = require("node:fs");
const path = require("node:path");
const { getGuildChannels, postMessage, deleteMessage, postAttachment } = require("./discordRest");
const { buildTurnAnnouncement } = require("../turnCalendar");
const { clockStatus, readGameState } = require("./gameState");
const { TURNS_CONSOLE_ROW, CONSOLE_TEXT } = require("./turnsConsoleRow");
const { docsPath } = require("./repoPaths");
const { clearMessagesExcept } = require("./discordRest");
const { isTurnsChannel } = require("./turnsChannelAccess");
const { TURN_BANNER_DIR, turnBannerPath } = require("./turnBanner");
const { pushToUser, vapidPublicKey } = require("./webPush");

// #turns is ONE rolling message: announcement, banner and console on a
// single post, deleted and reposted each turn. Discord renders content, then
// attachments, then components — content/banner/buttons in exactly that
// order, buttons at the bottom by construction.
//
// `push: false` reposts the console without the "turn has opened" web push —
// End Game rebuilds the console so its Move cutoff goes away.
async function postTurnsAnnouncement(prisma, newTurn, note, { push = true } = {}) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return;

  const channels = await getGuildChannels();
  const turnsChannel = channels.find(isTurnsChannel);
  if (!turnsChannel) return;

  // Move-cutoff clause omitted when frozen: no scheduled end to count back
  // from (db/lib/turnClock.js). Out of session it says so outright instead.
  const clock = await clockStatus(prisma);
  const text = [
    buildTurnAnnouncement(newTurn, note, { clockFrozen: clock.frozen, frozenReason: clock.reason }),
    CONSOLE_TEXT,
  ].join("\n");

  const [config, state] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    readGameState(prisma, {
      game: { select: { nukeDetonatedTurn: true, ascensionFiredTurn: true } },
    }),
  ]);
  const sent = await postTurnsConsole(prisma, turnsChannel.id, text, newTurn, config, state);
  if (!sent) console.error("Turn announcement: nothing could be posted to #turns");

  // AFTER the announcement, never before: a turn opens either way. Best-
  // effort throughout — an unconfigured deployment is a no-op.
  if (!push) return;
  await pushTurnOpen(prisma, text).catch((err) =>
    console.error("Turn announcement: push failed:", err),
  );
}

// Between one push and the next, so a hundred players don't become a hundred
// requests in the same instant.
const TURN_PUSH_GAP_MS = 40;

// Every player holding a living character, told the day has turned.
async function pushTurnOpen(prisma, text) {
  // Asked once, before the roster: no VAPID keys means every send is a no-op.
  if (!vapidPublicKey()) return;
  const firstLine = String(text ?? "").split("\n").find((line) => line.trim()) ?? "";
  const players = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: { discordUserId: true },
    distinct: ["discordUserId"],
  });
  for (const player of players) {
    if (!player.discordUserId) continue;
    await pushToUser(prisma, player.discordUserId, {
      title: "The turn has opened",
      body: firstLine,
      url: "/chat#gm",
    }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, TURN_PUSH_GAP_MS));
  }
}

// Posts the rolling message and records its id. Shared with the bot's
// cold-start path (bot/src/lib/turnsConsole.js) so the console can never
// exist in two shapes.
async function postTurnsConsole(prisma, channelId, text, turn, config, state = null) {
  if (config?.turnsConsoleChannelId === channelId && config.turnsConsoleMessageId) {
    await deleteMessage(channelId, config.turnsConsoleMessageId).catch(() => {});
  }

  // A missing asset must cost the guild its banner, never its announcement —
  // but not SILENTLY: absent from disk vs. a rejected upload are logged apart.
  const bannerFile = turnBannerPath(turn, state);
  if (turn && !bannerFile) {
    console.error(
      `Turn announcement: no banner for ${turn.banner ?? "(unset)"} in ${TURN_BANNER_DIR}`,
    );
  }

  let sent = null;
  if (bannerFile) {
    sent = await postAttachment(channelId, bannerFile, text, [TURNS_CONSOLE_ROW]).catch((err) => {
      console.error("Turn announcement: banner upload failed:", err);
      return null;
    });
  }
  // No banner, or upload failed: the announcement and buttons still go out.
  if (!sent) {
    sent = await postMessage(channelId, text, [TURNS_CONSOLE_ROW]).catch((err) => {
      console.error("Turn announcement: post failed:", err);
      return null;
    });
  }

  if (sent) {
    await prisma.gameConfig.update({
      where: { id: 1 },
      data: { turnsConsoleChannelId: channelId, turnsConsoleMessageId: sent.id },
    });
    // #turns is not in SPECIAL_CHANNELS, so the message wipe never reaches
    // it; this is that channel's only cleanup. Best-effort: a sweep failure
    // must not cost the announcement that already went out.
    await clearMessagesExcept(channelId, sent.id).catch((err) => {
      console.error("Turn announcement: #turns sweep failed:", err);
    });
  }
  return sent;
}

module.exports = { postTurnsAnnouncement, postTurnsConsole };
