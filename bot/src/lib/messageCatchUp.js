// Messages typed while the bot was not listening. The bot only proxies what
// `messageCreate` hands it, so anything typed while the gateway was away is
// missed three ways: the mask leaks (raw message under the player's REAL
// account, PROXYING.md §2), it never reaches the web (no ArchiveEntry row),
// and the next turn wipe deletes it unkept. Mirrors
// bot/src/lib/feedOutbox.js#drainFeedOutbox in the other direction; same
// posture: windowed, sequential, safe to run twice. NOT rare — Railway
// rebuilds on every push.
const { Collection, PermissionFlagsBits } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { snowflakeForTimestamp, messageTimestamp } = require("@lifeweb/db/lib/discordRest");
const { prepareSpeech, recordSpeech } = require("@lifeweb/db/lib/say");
const { placeKeyForChannel } = require("@lifeweb/db/lib/placeKey");
const { touchCharacterActivity } = require("@lifeweb/db/lib/characterActivity");
const { DM_KIND } = require("@lifeweb/db/lib/dmKinds");
const { isDesignatedTupperChannel, resolveChannelContext } = require("./channels");
const { attachmentPlaceholders } = require("./proxy");
const { sendDm } = require("./dm");
const { isDeadchatChannel } = require("@lifeweb/db/lib/deadchat");
const { ghostCharacterFor } = require("@lifeweb/db/lib/ghost");

// Two windows: inside REPOST the scene is still the scene, so the message
// gets the full ordinary treatment. Between REPOST and SCAN an hours-old line
// would read as talking to oneself, so the words are kept and the leak
// closed but Discord is left alone. SCAN is a ceiling, not a promise — the
// turn wipe empties these channels every turn.
const REPOST_WINDOW_MS = 2 * 60 * 60 * 1000;
const SCAN_WINDOW_MS = 26 * 60 * 60 * 1000;

const PER_CHANNEL_LIMIT = 100; // more than this while the bot was down is a room having a party
const SETTLE_MS = 10 * 1000; // leave the newest few seconds alone; messageCreate may still be handling them
const MIN_INTERVAL_MS = 60 * 1000; // a flapping gateway can re-identify every few seconds

let running = false;
let lastRunAt = 0;

// Every channel a player can be proxied in. `isDesignatedTupperChannel` is
// the same predicate messageCreate gates on, so this cannot drift.
async function candidateChannels(guild) {
  const found = new Collection();
  const active = await guild.channels.fetchActiveThreads().catch((err) => {
    console.error("Catch-up: couldn't list active threads:", err.message ?? err);
    return null;
  });
  for (const thread of active?.threads?.values() ?? []) found.set(thread.id, thread);
  for (const channel of guild.channels.cache.values()) { // non-thread half: zone #summary and #cerberon
    if (!found.has(channel.id)) found.set(channel.id, channel);
  }
  return [...found.values()].filter((channel) => {
    try {
      return isDesignatedTupperChannel(channel);
    } catch {
      return false;
    }
  });
}

// Can we actually take a raw message down in here? Runs BEFORE anything is
// posted: if the delete would fail, the repost would duplicate on every
// restart until the turn wipe, so a channel the bot cannot tidy isn't touched.
function canTidy(channel, guild) {
  const me = guild.members.me;
  if (!me) return false;
  const perms = channel.permissionsFor(me);
  return Boolean(perms?.has(PermissionFlagsBits.ManageMessages));
}

// What is still sitting in one channel that the bot never handled. No
// cursor, deliberately: the ordinary path DELETES the player's message last,
// so a raw message still standing is by definition unproxied — existence is
// the marker. A watermark cursor would be wrong: the stored
// ArchiveEntry.discordMessageId is the WEBHOOK repost's, minted later than
// the raw message, so it would sit ahead of anything still waiting.
async function missedIn(channel, sinceMs, settleBefore) {
  const after = snowflakeForTimestamp(sinceMs);
  const fetched = await channel.messages.fetch({ after, limit: PER_CHANNEL_LIMIT }).catch((err) => {
    if (err?.status !== 404 && err?.status !== 403) { // a thread the wipe deleted meanwhile is ordinary
      console.error(`Catch-up: couldn't read ${channel.name ?? channel.id}:`, err.message ?? err);
    }
    return null;
  });
  if (!fetched) return [];
  return selectMissed([...fetched.values()], { channelId: channel.id, settleBefore });
}

// Which of a channel's messages this pass is allowed to touch. Pure, exported for tests.
function selectMissed(messages, { channelId, settleBefore }) {
  return messages
    .filter((m) => !m.author?.bot && !m.webhookId && !m.system)
    .filter((m) => m.id !== channelId) // a thread's opening message deleting it destroys the whole thread
    .filter((m) => m.createdTimestamp <= settleBefore)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp); // oldest first
}

function recoveryKind(createdTimestamp, now = Date.now()) {
  return createdTimestamp >= now - REPOST_WINDOW_MS ? "repost" : "file";
}

// Keep the words, close the leak, leave the room alone — the out-of-window
// half. The row carries the message's REAL timestamp and no
// discordMessageId. Inert to the outbox: feedOutbox.js#pushRow refuses
// anything whose `source` isn't "WEB".
async function fileWithoutReposting(channel, character, message, { ghost = false } = {}) {
  const placeKey = await placeKeyForChannel(prisma, {
    channelId: channel.id,
    parentId: channel.parent?.id,
  });
  const prepared = await prepareSpeech(prisma, {
    character,
    placeKey,
    content: message.content,
    source: "DISCORD",
    ghost,
  });
  // A refusal (Mute, Paralyzed, etc) drops the words rather than recording
  // what the gates would have refused; the delete still happens regardless.
  if (prepared.ok) {
    const context = resolveChannelContext(channel);
    await recordSpeech(prisma, prepared, {
      discordChannelId: channel.id,
      zoneId: context.zoneId,
      zoneName: context.zoneName,
      channelKind: context.channelKind,
      threadName: context.threadName,
      sentAt: new Date(message.createdTimestamp),
      content: [prepared.rowContent ?? prepared.content, ...attachmentPlaceholders(message)]
        .filter(Boolean)
        .join("\n"),
    });
    // A ghost is not "active" in the sense the inactivity report means — see the same skip in
    // web/app/api/feed/say/route.js.
    if (!ghost) await touchCharacterActivity(prisma, character.id).catch(() => {});
  }
  return prepared.ok;
}

async function deleteLeak(message) { // retried once — leaving one standing is the failure that costs something
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await message.delete();
      return true;
    } catch (err) {
      if (err?.status === 404) return true;
      if (attempt === 1) {
        console.error(
          `Catch-up: MASK LEAK — couldn't remove ${message.id} in ${message.channelId}:`,
          err.message ?? err,
        );
      }
    }
  }
  return false;
}

async function tellFiledWithoutReposting(client, entries) { // one DM per player per run, not per message
  for (const [discordUserId, count] of entries) {
    const user = await client.users.fetch(discordUserId).catch(() => null);
    if (!user) continue;
    const line =
      count === 1
        ? "A message you sent while the bot was down has been recorded."
        : `${count} messages you sent while the bot was down have been recorded.`;
    await sendDm(user, `» *${line}*`, { kind: DM_KIND.QUIET }).catch(() => {});
  }
}

// The sweep. Returns a small tally for the caller's log line. Sequential
// throughout, never Promise.all — a fan-out bursts Discord's rate-limit
// buckets (ARCHITECTURE.md §5).
async function catchUpMissedMessages(client, guild, { reason = "startup" } = {}) {
  if (running) return null;
  if (Date.now() - lastRunAt < MIN_INTERVAL_MS) return null;
  running = true;
  const startedAt = Date.now();
  const tally = { channels: 0, reposted: 0, filed: 0, skipped: 0, leaked: 0 };
  const filedFor = new Map();

  const { execute: handleMessage } = require("../events/messageCreate"); // late require avoids a circular close

  try {
    const sinceMs = startedAt - SCAN_WINDOW_MS;
    const settleBefore = startedAt - SETTLE_MS;

    for (const channel of await candidateChannels(guild)) {
      const lastAt = channel.lastMessageId ? messageTimestamp(channel.lastMessageId) : null; // no request if nothing's been said in-window
      if (lastAt !== null && lastAt < sinceMs) continue;

      const missed = await missedIn(channel, sinceMs, settleBefore);
      if (missed.length === 0) continue;

      if (!canTidy(channel, guild)) {
        tally.skipped += missed.length;
        console.error(
          `Catch-up: ${missed.length} message(s) left in ${channel.name ?? channel.id} — ` +
          "the bot can't delete there, and reposting without deleting would duplicate on every restart.",
        );
        continue;
      }
      tally.channels += 1;

      const authorIds = [...new Set(missed.map((m) => m.author.id))];
      const alive = await prisma.character.findMany({
        where: { discordUserId: { in: authorIds }, status: "ALIVE" },
        select: { id: true, discordUserId: true },
      });
      // Mirroring is not checked here: messageCreate proxies and deletes a
      // living character's message regardless, and a raw message left under
      // the player's real name is the one outcome catch-up exists to prevent.
      const byUser = new Map(alive.map((c) => [c.discordUserId, c]));

      // A GHOST typing in Deadchat while the bot was away. Resolved per author rather than per
      // message, and only in that one channel — everywhere else "no living character" is still the
      // whole answer, exactly as messageCreate gives it.
      const deadchatHere = await isDeadchatChannel(prisma, channel.id).catch(() => false);
      const ghostByUser = new Map();
      if (deadchatHere) {
        for (const authorId of authorIds) {
          if (byUser.has(authorId)) continue;
          const ghost = await ghostCharacterFor(prisma, authorId).catch(() => null);
          if (ghost) ghostByUser.set(authorId, ghost);
        }
      }

      for (const message of missed) {
        if (!byUser.has(message.author.id) && !ghostByUser.has(message.author.id)) { // no living character and no body: same answer messageCreate gives
          tally.skipped += 1;
          continue;
        }
        try {
          if (recoveryKind(message.createdTimestamp, startedAt) === "repost") {
            // The ordinary handler, re-entered whole, so a recovered message
            // is indistinguishable from one caught live.
            await handleMessage(message);
            tally.reposted += 1;
          } else {
            const ghost = ghostByUser.get(message.author.id) ?? null;
            const character =
              ghost ??
              (await prisma.character.findFirst({
                where: { discordUserId: message.author.id, status: "ALIVE" },
              }));
            if (character && (await fileWithoutReposting(channel, character, message, { ghost: Boolean(ghost) }))) {
              tally.filed += 1;
              filedFor.set(message.author.id, (filedFor.get(message.author.id) ?? 0) + 1);
            } else {
              tally.skipped += 1;
            }
            if (!(await deleteLeak(message))) tally.leaked += 1;
          }
        } catch (err) {
          console.error(`Catch-up: failed on a message in ${channel.name ?? channel.id}:`, err.message ?? err);
          tally.skipped += 1;
        }
      }
    }
  } finally {
    running = false;
    lastRunAt = Date.now();
  }

  await tellFiledWithoutReposting(client, filedFor).catch(() => {});

  if (tally.reposted || tally.filed || tally.skipped) { // silent on a clean deploy
    const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
    console.log(
      `Catch-up (${reason}): ${tally.reposted} reposted, ${tally.filed} filed, ${tally.skipped} skipped` +
      `${tally.leaked ? `, ${tally.leaked} LEFT STANDING` : ""} across ${tally.channels} channel(s) in ${seconds}s`,
    );
  }
  return tally;
}

module.exports = {
  catchUpMissedMessages,
  selectMissed,
  recoveryKind,
  REPOST_WINDOW_MS,
  SETTLE_MS,
};
