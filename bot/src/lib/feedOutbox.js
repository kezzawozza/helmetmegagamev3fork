// The outbox: the bot is the only process that talks to Discord about chat.
// A message typed into /chat is written straight to ArchiveEntry with
// `source = WEB` and no `discordMessageId`; this module listens on the
// `bascinet_feed` NOTIFY channel, picks those rows up, and posts them via
// the same webhook path a proxied message takes. Two ways in: the LISTEN is
// the fast path, drainFeedOutbox() is the catch-up run once on ready, making
// a bot restart mid-send harmless.

const { Client } = require("pg");
const { prisma } = require("@lifeweb/db");
const {
  postAsCharacter,
  ensureChannelWebhook,
  editWebhookMessage,
  deleteWebhookMessage,
  addThreadMember,
} = require("@lifeweb/db/lib/discordRest");
const { addConversationMember } = require("@lifeweb/db/lib/conversations");
const { loadForcedName, loadConcealment, presentedIdentity } = require("@lifeweb/db/lib/presentedIdentity");
const { pushToUser } = require("@lifeweb/db/lib/webPush");
const { FEED_CHANNEL } = require("@lifeweb/db/lib/feedNotify");
const { discordTargetForPlaceKey, archiveContextForPlaceKey, parsePlaceKey } = require("@lifeweb/db/lib/placeKey");
const {
  tokensToRoles,
  earshotForPlaceKey,
  inEarshot,
} = require("@lifeweb/db/lib/characterMentions");
const { sendDm } = require("@lifeweb/db/lib/dm");
const { currentGameId } = require("@lifeweb/db/lib/archive");

const DRAIN_WINDOW_MS = 24 * 60 * 60 * 1000; // older rows aren't worth posting into a scene long moved on
const DRAIN_LIMIT = 200;

const BACKOFF_MIN_MS = 1000; // doubling reconnect backoff to a cap
const BACKOFF_MAX_MS = 60_000;

let listener = null;
let backoffMs = BACKOFF_MIN_MS;
let stopped = false;
let queue = Promise.resolve(); // one row at a time, in arrival order

function enqueue(fn) {
  queue = queue.then(fn).catch((err) => console.error("Feed outbox job failed:", err));
  return queue;
}

// Every callback below goes through this. An exception out of a pg event
// handler is an unhandled rejection, and an unhandled rejection kills the bot.
function guarded(label, fn) {
  return (...args) => {
    try {
      const out = fn(...args);
      if (out && typeof out.catch === "function") out.catch((err) => console.error(`${label} failed:`, err));
    } catch (err) {
      console.error(`${label} failed:`, err);
    }
  };
}

// Which Discord channel/thread a place key names (db/lib/placeKey.js#discordTargetForPlaceKey).
async function targetFor(placeKey) {
  const target = await discordTargetForPlaceKey(prisma, placeKey);
  if (!target) console.log(`Feed outbox: no Discord target for place key ${placeKey} — skipping.`);
  return target;
}

// Same identity load messageCreate.js does: forced name beats concealment beats own.
async function identityPiecesFor(characterId) {
  const [forcedName, concealment] = await Promise.all([
    loadForcedName(prisma, characterId),
    loadConcealment(prisma, characterId),
  ]);
  return { forcedName, concealment };
}

// Caps DMs one web-sent line can fan out; bot/src/events/messageCreate.js caps the Discord path the same way.
const MAX_MENTION_RELAYS = 10;

function messageLink(channelId, messageId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

// The relay DM for a WEB-origin row — same shape as a Discord-origin mention
// (bot/src/lib/mentions.js#notifyMentioned): where + jump link, never the words.
// Uses db/lib/dm.js (REST) since the outbox has no discord.js client. Concealed sends relay nothing.
async function relayWebMentions({ row, characters, concealed, channelId, messageId }) {
  if (concealed || characters.length === 0) return;
  const link = messageLink(channelId, messageId);
  if (!link) return;

  const [earshot, context, conversation] = await Promise.all([
    earshotForPlaceKey(prisma, row.placeKey),
    archiveContextForPlaceKey(prisma, row.placeKey), // same zone/thread names /archive uses
    // Only a Conversation turns a mention into an invite (bot/src/events/messageCreate.js);
    // a private Room is gated on a key tag instead (db/lib/roomAccess.js).
    prisma.playerThread
      .findUnique({ where: { threadId: channelId }, select: { id: true, locationId: true } })
      .catch((err) => {
        console.error("Conversation lookup failed for a web mention:", err);
        return null;
      }),
  ]);
  const place = context.zoneName ?? "somewhere";
  const where = context.threadName ? `${place} · ${context.threadName}` : place;

  for (const target of characters.slice(0, MAX_MENTION_RELAYS)) {
    if (conversation) {
      // Same contract as /add: membership row, then an invite row (db/lib/threadInvites.js
      // replays it on arrival). A "web only" target has no Discord presence to add (CHAT.md §6).
      await addConversationMember(prisma, { playerThreadId: conversation.id, characterId: target.id });
      await prisma.playerThreadInvite
        .upsert({
          where: { threadId_characterId: { threadId: channelId, characterId: target.id } },
          update: {},
          create: { threadId: channelId, characterId: target.id },
        })
        .catch((err) => console.error("Failed to record a web thread invite:", err?.message ?? err));
      if (target.locationId === conversation.locationId && !target.webOnly && target.discordUserId) {
        await addThreadMember(channelId, target.discordUserId).catch(() => { });
      }
    }
    if (!target.discordUserId) continue;
    if (!conversation && !inEarshot(target, earshot)) continue;
    await sendDm(prisma, target.discordUserId, `*You were mentioned in ${where}.*\n${link}`, {
      source: "mention",
      meta: { placeKey: row.placeKey, where },
    }).catch((err) => console.error(`Feed outbox couldn't relay a mention to ${target.name}:`, err));
    // Browser notification for a closed /chat tab; after the DM and wrapped so a failed push never costs it.
    await pushToUser(prisma, target.discordUserId, {
      title: `${target.name} was named`,
      body: `in ${where}`,
      url: `/chat#${encodeURIComponent(row.placeKey)}`,
    }).catch(() => { });
  }
}

const ROW_SELECT = {
  id: true,
  seq: true,
  placeKey: true,
  characterId: true,
  // The frozen name. Only a Deadchat row needs it, but it is one column on a select that already
  // runs for every row, and a conditional select would be two shapes to keep in step.
  characterName: true,
  content: true,
  source: true,
  discordMessageId: true,
  editedAt: true,
  deletedAt: true,
  discordSyncedAt: true,
};

// Is Discord behind on this row? `discordSyncedAt` is the watermark.
function behind(stamp, syncedAt) {
  if (!stamp) return false;
  if (!syncedAt) return true;
  return new Date(stamp).getTime() > new Date(syncedAt).getTime();
}

// One row, posted. Returns true when Discord took it.
async function pushRow(row) {
  if (!row || row.source !== "WEB" || row.discordMessageId || row.deletedAt) return false;
  if (!row.characterId) return false;

  // Re-read right before posting: drain and a notification can both pick this row up at
  // startup, and the updateMany guard below only stops the second CLAIM, not the second post.
  const fresh = await prisma.archiveEntry.findUnique({
    where: { id: row.id },
    select: { discordMessageId: true, deletedAt: true },
  });
  if (!fresh || fresh.discordMessageId || fresh.deletedAt) return false;

  const target = await targetFor(row.placeKey);
  if (!target) return false;

  const character = await prisma.character.findUnique({
    where: { id: row.characterId },
    // Exactly what presentedIdentity reads (concealed, age/gender for the alias, updatedAt for the avatar cache-bust).
    select: { id: true, name: true, concealed: true, age: true, gender: true, updatedAt: true },
  });
  if (!character) return false;

  const { forcedName, concealment } = await identityPiecesFor(character.id);

  // Row stores `{char:<id>}`; Discord reads `<@&roleId>` (db/lib/characterMentions.js).
  // Rewritten here, not at write time, so /chat and /archive keep the face-neutral text.
  const { content, characters } = await tokensToRoles(prisma, row.content);

  // Resolved here too, since the mention relay below reads `alias` (set for both a hood and a forced name).
  const identity = presentedIdentity(character, { forcedName, concealment });

  // A Deadchat row carries a name composed and frozen at send time (db/lib/say.js): the character's
  // name plus the player's account handle. Re-deriving it from the live character here would drop
  // the account half and re-apply a hood the corpse is still wearing.
  const deadchat = parsePlaceKey(row.placeKey)?.kind === "dead";
  const posted = await postAsCharacter(target.channelId, character, content, {
    forcedName,
    concealment,
    threadId: target.threadId,
    displayName: deadchat ? row.characterName : null,
  });
  if (!posted?.id) return false;

  // updateMany, not update: the row may have been claimed by the other path since it was read.
  const claimed = await prisma.archiveEntry.updateMany({
    where: { id: row.id, discordMessageId: null },
    data: {
      discordMessageId: posted.id,
      discordChannelId: target.threadId ?? target.channelId,
      discordSyncedAt: new Date(),
    },
  });
  if (claimed.count === 0) return false;

  // After the claim, so a row that lost the race never DMs twice. Best-effort: a failed relay never costs the post.
  //
  // Never from Deadchat. A mention typed there would DM a living player about something said in a
  // room they cannot reach — the dead reaching into the world, which this seat must not do. Refused
  // by name rather than left to earshot returning nothing for an unknown kind.
  if (!deadchat) {
    await relayWebMentions({
      row,
      characters,
      concealed: Boolean(identity.alias),
      channelId: target.threadId ?? target.channelId,
      messageId: posted.id,
    }).catch((err) => console.error("Feed outbox mention relay failed:", err));
  }

  return true;
}

// One row, edited on Discord — runs for a ✏️ in Discord exactly as for a ✎ on /chat.
async function editRow(row) {
  if (!row?.discordMessageId || row.deletedAt) return false;

  // Re-read right before acting — same guard as pushRow, against two edits racing.
  const fresh = await prisma.archiveEntry.findUnique({
    where: { id: row.id },
    select: { content: true, editedAt: true, deletedAt: true, discordSyncedAt: true, discordMessageId: true },
  });
  if (!fresh || fresh.deletedAt || !fresh.discordMessageId) return false;
  if (!behind(fresh.editedAt, fresh.discordSyncedAt)) return false;

  const target = await targetFor(row.placeKey);
  if (!target) return false;

  const webhook = await ensureChannelWebhook(target.channelId);
  const { content } = await tokensToRoles(prisma, fresh.content); // same rewrite pushRow does
  await editWebhookMessage(webhook, fresh.discordMessageId, content, target.threadId);

  await prisma.archiveEntry.update({ where: { id: row.id }, data: { discordSyncedAt: new Date() } });
  return true;
}

// One row, deleted on Discord. The row stays (soft delete) with its discordMessageId, so nothing reposts it.
async function deleteRow(row) {
  if (!row?.discordMessageId || !row.deletedAt) return false;

  const fresh = await prisma.archiveEntry.findUnique({
    where: { id: row.id },
    select: { deletedAt: true, discordSyncedAt: true, discordMessageId: true },
  });
  if (!fresh?.deletedAt || !fresh.discordMessageId) return false;
  if (!behind(fresh.deletedAt, fresh.discordSyncedAt)) return false;

  const target = await targetFor(row.placeKey);
  if (!target) return false;

  const webhook = await ensureChannelWebhook(target.channelId);
  await deleteWebhookMessage(webhook, fresh.discordMessageId, target.threadId); // allow404: already-removed is fine

  await prisma.archiveEntry.update({ where: { id: row.id }, data: { discordSyncedAt: new Date() } });
  return true;
}

// Chosen off the ROW, not the notification's `op` — the row is the truth, and the drain has no op at all.
async function syncRow(row) {
  if (!row) return false;
  if (row.deletedAt) return deleteRow(row);
  if (!row.discordMessageId) return pushRow(row);
  if (row.editedAt) return editRow(row);
  return false;
}

async function syncBySeq(seq) {
  const row = await prisma.archiveEntry.findUnique({ where: { seq }, select: ROW_SELECT });
  await syncRow(row);
}

// Every row of the last day Discord is behind on. Called on ready, so a message sent, edited or deleted while
// the bot was down still lands.
async function drainFeedOutbox() {
  try {
    // Scoped to the current game too: sentAt alone can't tell a live row from one an
    // archive re-import brought back inside the window, which would narrate a dead game.
    const gameId = await currentGameId(prisma);
    const rows = await prisma.archiveEntry.findMany({
      where: {
        ...(gameId ? { gameId } : {}),
        sentAt: { gte: new Date(Date.now() - DRAIN_WINDOW_MS) },
        OR: [
          { source: "WEB", discordMessageId: null, deletedAt: null }, // never posted
          // Edited or deleted while down. Prisma can't compare two columns in a filter, so this is a
          // coarse "has one of the two stamps" test; syncRow's re-read settles it exactly.
          { discordMessageId: { not: null }, deletedAt: { not: null } },
          { discordMessageId: { not: null }, editedAt: { not: null } },
        ],
      },
      orderBy: { seq: "asc" },
      take: DRAIN_LIMIT,
      select: ROW_SELECT,
    });
    let sent = 0;
    for (const row of rows) {
      try {
        if (await syncRow(row)) sent += 1;
      } catch (err) {
        console.error(`Feed outbox couldn't sync archive row ${row.id}:`, err);
      }
    }
    if (sent) console.log(`Feed outbox: ${sent} archive row(s) carried across to Discord.`);
    return sent;
  } catch (err) {
    console.error("Feed outbox drain failed:", err);
    return 0;
  }
}

function scheduleReconnect() {
  if (stopped) return;
  const wait = backoffMs;
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
  setTimeout(guarded("Feed outbox reconnect", openListener), wait).unref?.();
}

// One pg client, not a Pool: LISTEN is a property of a single session.
async function openListener() {
  if (stopped || listener) return;
  if (!process.env.DATABASE_URL) {
    console.warn("Feed outbox: no DATABASE_URL, the web feed will not reach Discord.");
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  listener = client;

  const drop = guarded("Feed outbox listener", (err) => {
    if (listener !== client) return;
    if (err) console.error("Feed outbox listener error:", err);
    listener = null;
    client.removeAllListeners();
    client.end().catch(() => { });
    scheduleReconnect();
  });

  client.on("error", drop);
  client.on("end", () => drop(null));

  client.on(
    "notification",
    guarded("Feed outbox notification", (msg) => {
      if (msg.channel !== FEED_CHANNEL || !msg.payload) return;
      let parsed;
      try {
        parsed = JSON.parse(msg.payload);
      } catch {
        return;
      }
      if (!parsed?.seq) return;
      const seq = BigInt(parsed.seq); // payload carries seq as a string on purpose; Number would lose precision
      enqueue(() => syncBySeq(seq));
    }),
  );

  try {
    await client.connect();
    await client.query(`LISTEN ${FEED_CHANNEL}`);
    backoffMs = BACKOFF_MIN_MS;
    console.log("Feed outbox listening on bascinet_feed.");
  } catch (err) {
    console.error("Feed outbox could not start listening:", err);
    if (listener === client) {
      listener = null;
      client.removeAllListeners();
      client.end().catch(() => { });
    }
    scheduleReconnect();
  }
}

// Called from ready. Never throws: a bot that can't start the outbox still comes up, just one-way.
async function startFeedOutbox() {
  stopped = false;
  await openListener().catch((err) => console.error("Feed outbox failed to start:", err));
  await enqueue(drainFeedOutbox); // same queue as notifications, so the drain never races a live row
}

module.exports = { startFeedOutbox, drainFeedOutbox };
