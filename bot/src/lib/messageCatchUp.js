// Messages typed while the bot was not listening.
//
// The bot only proxies what `messageCreate` hands it, so anything typed while
// the gateway was away is missed three ways at once, and the first is the one
// that matters:
//
//   1. The mask leaks. The raw message sits in the channel under the player's
//      REAL Discord account and nickname. Hiding that is the load-bearing rule
//      of the whole proxy (docs/systemdocs/PROXYING.md §2).
//   2. It never reaches the web. /chat and /archive render ArchiveEntry rows
//      and never read Discord, so no row means invisible forever.
//   3. The next turn wipe deletes it, so it vanishes having never been kept.
//
// This is the mirror of bot/src/lib/feedOutbox.js#drainFeedOutbox — that one
// replays web rows that never reached Discord, this one replays Discord
// messages that never reached the database — and it takes the same posture:
// windowed, sequential, and safe to run twice.
//
// It is NOT rare. Railway rebuilds both services on every push, so the bot
// restarts many times a day and every restart is one of these windows.
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

// Two windows, because "recover it" means two different things depending on
// how long the words have been sitting there.
//
// Inside REPOST the gap was short enough that the scene is still the scene, so
// the message gets the full ordinary treatment and nobody can tell. Between
// REPOST and SCAN, putting an hours-old line back into a room that moved on
// would read as somebody talking to themselves, so the words are kept and the
// leak is closed but Discord is left alone — the same reasoning the outbox
// gives for its own window.
//
// SCAN is a ceiling rather than a promise: the turn wipe empties these channels
// every turn, so Discord rarely still holds even that much. One turn plus slack.
const REPOST_WINDOW_MS = 2 * 60 * 60 * 1000;
const SCAN_WINDOW_MS = 26 * 60 * 60 * 1000;

// Per channel. A room that really produced more than this while the bot was
// down is a room having a party, and the tail of it is not worth the requests.
const PER_CHANNEL_LIMIT = 100;

// Leave the newest few seconds alone. By the time this runs the gateway is
// live, so a message this recent may be in `messageCreate`'s hands right now —
// and both of us proxying it would post it twice.
const SETTLE_MS = 10 * 1000;

// A flapping gateway can re-identify every few seconds. One sweep at a time,
// and not more often than this, or a bad connection becomes a request storm —
// the shape bot/src/index.js warns can trip Discord's IP ban.
const MIN_INTERVAL_MS = 60 * 1000;

let running = false;
let lastRunAt = 0;

// Every channel a player can be proxied in. `isDesignatedTupperChannel` is the
// same predicate messageCreate gates on — it handles threads itself, by their
// parent — so this cannot drift from the real rule. Top-level Location
// channels are deliberately outside it: players hold no Send there, and what
// is left is a GM typing, whose words are their own.
//
// Active threads come from ONE request. Auto-archive is seven days everywhere,
// so no thread can archive inside a turn and the active set is complete.
async function candidateChannels(guild) {
  const found = new Collection();
  const active = await guild.channels.fetchActiveThreads().catch((err) => {
    console.error("Catch-up: couldn't list active threads:", err.message ?? err);
    return null;
  });
  for (const thread of active?.threads?.values() ?? []) found.set(thread.id, thread);
  // The non-thread half — zone #summary and #cerberon — lives in the ordinary
  // channel cache rather than the thread list.
  for (const channel of guild.channels.cache.values()) {
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

// Can we actually take a raw message down in here?
//
// This is the guard that matters most, and it runs BEFORE anything is posted.
// Recovering a message means reposting it and then deleting the original; if
// the delete is going to fail, the repost would come back on the next restart
// and the one after that — a duplicate per restart until the turn wipe, which
// on this deploy cadence is a lot of them. So a channel the bot cannot tidy is
// a channel it does not touch at all.
function canTidy(channel, guild) {
  const me = guild.members.me;
  if (!me) return false;
  const perms = channel.permissionsFor(me);
  return Boolean(perms?.has(PermissionFlagsBits.ManageMessages));
}

// What is still sitting in one channel that the bot never handled.
//
// No cursor, and deliberately no watermark column: the ordinary path DELETES
// the player's message as its last step, so a raw message still standing is by
// definition one nobody proxied. Existence is the marker, which is also what
// makes the whole pass safe to run twice.
//
// It is worth saying why the obvious cursor is wrong, because it looks right.
// Taking the newest ArchiveEntry.discordMessageId for the channel and asking
// for messages `after` it would skip work: the stored id is the WEBHOOK
// repost's, minted later than the raw message it replaced, so the cursor sits
// ahead of anything still waiting. One failed delete and that message is
// skipped by every future run — the message that most needed recovering.
async function missedIn(channel, sinceMs, settleBefore) {
  const after = snowflakeForTimestamp(sinceMs);
  const fetched = await channel.messages.fetch({ after, limit: PER_CHANNEL_LIMIT }).catch((err) => {
    // A thread the wipe deleted between listing and reading is ordinary.
    if (err?.status !== 404 && err?.status !== 403) {
      console.error(`Catch-up: couldn't read ${channel.name ?? channel.id}:`, err.message ?? err);
    }
    return null;
  });
  if (!fetched) return [];
  return selectMissed([...fetched.values()], { channelId: channel.id, settleBefore });
}

// Which of a channel's messages this pass is allowed to touch. Pure, and
// exported for the tests — every clause here is one that would cost something
// real if it were dropped.
function selectMissed(messages, { channelId, settleBefore }) {
  return messages
    .filter((m) => !m.author?.bot && !m.webhookId && !m.system)
    // A thread's opening message carries the THREAD's own id, and deleting it
    // destroys the whole thread rather than one line. messageWipe.js guards the
    // same thing by keeping Room.starterMessageId.
    .filter((m) => m.id !== channelId)
    .filter((m) => m.createdTimestamp <= settleBefore)
    // Oldest first: a scene replayed backwards is worse than one replayed late.
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

// Put it back in the room, or just keep the words? Pure, and the one decision
// the whole feature turns on.
function recoveryKind(createdTimestamp, now = Date.now()) {
  return createdTimestamp >= now - REPOST_WINDOW_MS ? "repost" : "file";
}

// Keep the words, close the leak, leave the room alone. The out-of-window half.
//
// The row carries the message's REAL timestamp, which is the point — it lands
// in /archive where it was actually said rather than where the bot woke up. It
// carries no discordMessageId, because there is no character post to point at.
//
// Such a row is inert to the outbox: feedOutbox.js#pushRow opens by refusing
// anything whose `source` is not "WEB". Worth stating here because it is not
// obvious, and a future edit to that guard would quietly start reposting
// hours-old text into rooms that have moved on.
async function fileWithoutReposting(channel, character, message) {
  const placeKey = await placeKeyForChannel(prisma, {
    channelId: channel.id,
    parentId: channel.parent?.id,
  });
  const prepared = await prepareSpeech(prisma, {
    character,
    placeKey,
    content: message.content,
    source: "DISCORD",
  });
  // A refusal means the character could not have said it anyway — Mute,
  // Paralyzed, empty after the transforms. Drop the words rather than record
  // something the gates would have turned away, and do NOT hand it back: a
  // "you were too quiet to shout" DM hours late is noise. The delete still
  // happens, because the leak is not conditional on the line being sayable.
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
    await touchCharacterActivity(prisma, character.id).catch(() => {});
  }
  return prepared.ok;
}

// The raw message under the player's real name. Retried once — a transient
// failure is worth a second go, and leaving one standing is the failure that
// actually costs somebody something.
async function deleteLeak(message) {
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

// One line per player per run, not one per message: somebody who wrote thirty
// lines during an outage must not get thirty DMs.
async function tellFiledWithoutReposting(client, entries) {
  for (const [discordUserId, count] of entries) {
    const user = await client.users.fetch(discordUserId).catch(() => null);
    if (!user) continue;
    const line =
      count === 1
        ? "A message you sent while the bot was down has been kept in your archive."
        : `${count} messages you sent while the bot was down have been kept in your archive.`;
    await sendDm(user, `» *${line}*`, { kind: DM_KIND.QUIET }).catch(() => {});
  }
}

// The sweep. Returns a small tally for the caller's log line.
//
// Sequential throughout, never Promise.all: this walks every active thread in
// the guild, and a fan-out across them is exactly the shape that bursts
// Discord's rate-limit buckets (docs/systemdocs/ARCHITECTURE.md §5).
async function catchUpMissedMessages(client, guild, { reason = "startup" } = {}) {
  if (running) return null;
  if (Date.now() - lastRunAt < MIN_INTERVAL_MS) return null;
  running = true;
  const startedAt = Date.now();
  const tally = { channels: 0, reposted: 0, filed: 0, skipped: 0, leaked: 0 };
  const filedFor = new Map();

  // Required late, not at module load: bot/src/events/messageCreate.js requires
  // this module's neighbours, and a top-level require here would close the
  // circle before either module finished defining its exports.
  const { execute: handleMessage } = require("../events/messageCreate");

  try {
    const sinceMs = startedAt - SCAN_WINDOW_MS;
    const settleBefore = startedAt - SETTLE_MS;

    for (const channel of await candidateChannels(guild)) {
      // Nothing has been said in here since before the window — no request.
      // This is what keeps a quiet guild's sweep down to one call in total.
      const lastAt = channel.lastMessageId ? messageTimestamp(channel.lastMessageId) : null;
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
      const byUser = new Map(alive.map((c) => [c.discordUserId, c]));

      for (const message of missed) {
        // No living character is the same answer messageCreate gives: leave it
        // alone. Nobody is behind it in the fiction, so no mask can slip.
        if (!byUser.has(message.author.id)) {
          tally.skipped += 1;
          continue;
        }
        try {
          if (recoveryKind(message.createdTimestamp, startedAt) === "repost") {
            // The ordinary handler, re-entered whole. It re-reads the character
            // and identity, proxies, records, deletes, and relays mentions —
            // and inside the window every one of those is still the right thing
            // to do, since the jump link points at a message that exists and a
            // role chip never notifies on its own. A recovered message is meant
            // to be indistinguishable from one caught live, and the surest way
            // to manage that is to run the same code.
            await handleMessage(message);
            tally.reposted += 1;
          } else {
            const character = await prisma.character.findFirst({
              where: { discordUserId: message.author.id, status: "ALIVE" },
            });
            if (character && (await fileWithoutReposting(channel, character, message))) {
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

  // Silent when there was nothing to do, which is the common case — a clean
  // deploy should print nothing at all.
  if (tally.reposted || tally.filed || tally.skipped) {
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
