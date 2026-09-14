// The outbox: the bot is the only process that talks to Discord about chat.
//
// A message typed into /chat is written straight to ArchiveEntry with
// `source = WEB` and no `discordMessageId`. This module listens on the
// `bascinet_feed` NOTIFY channel, picks those rows up, and posts them into the
// Location's Discord channel through the same webhook path a proxied message
// takes. The web app therefore never needs a Discord token for chat, and one
// process owns the rate-limit lane.
//
// Two ways in, on purpose. The LISTEN is the fast path (a fraction of a second
// from send to Discord); drainFeedOutbox() is the catch-up, run once on ready,
// which is what makes a bot restart mid-send harmless. That is the same
// posture every other catch-up pass in ready.js takes.

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
const { discordTargetForPlaceKey, archiveContextForPlaceKey } = require("@lifeweb/db/lib/placeKey");
const {
  tokensToRoles,
  earshotForPlaceKey,
  inEarshot,
} = require("@lifeweb/db/lib/characterMentions");
const { sendDm } = require("@lifeweb/db/lib/dm");
const { currentGameId } = require("@lifeweb/db/lib/archive");

// How far back the catch-up looks. A row older than this that never reached
// Discord is not worth posting into a scene that moved on hours ago — the
// archive still has it.
const DRAIN_WINDOW_MS = 24 * 60 * 60 * 1000;
const DRAIN_LIMIT = 200;

// Reconnect backoff, doubling to a cap. A listener that retried in a tight
// loop against a database that is down would be the loudest thing in the log.
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 60_000;

let listener = null;
let backoffMs = BACKOFF_MIN_MS;
let stopped = false;
// One row at a time, in arrival order: two concurrent posters against the
// same channel webhook would interleave a scene.
let queue = Promise.resolve();

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

// Which Discord channel and thread a place key names. Every kind is wired
// since phase 1: a Room or a Conversation is a thread, and its webhook lives
// on the parent channel (db/lib/placeKey.js#discordTargetForPlaceKey).
async function targetFor(placeKey) {
  const target = await discordTargetForPlaceKey(prisma, placeKey);
  if (!target) console.log(`Feed outbox: no Discord target for place key ${placeKey} — skipping.`);
  return target;
}

// The identity load messageCreate.js does, for a character the web sent as:
// a forced name beats a concealment beats their own, and postAsCharacter
// resolves the three itself given these two pieces.
async function identityPiecesFor(characterId) {
  const [forcedName, concealment] = await Promise.all([
    loadForcedName(prisma, characterId),
    loadConcealment(prisma, characterId),
  ]);
  return { forcedName, concealment };
}

// How many people one web-sent line may DM. The Discord path caps at the same
// place (bot/src/events/messageCreate.js) for the same reason: each target is
// a DM channel open, a send and a row, all after the room has already read the
// message.
const MAX_MENTION_RELAYS = 10;

function messageLink(channelId, messageId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

// The relay DM for a WEB-origin row, and it is the same DM a Discord-origin
// mention sends (bot/src/lib/mentions.js#notifyMentioned): where, and a jump
// link, never the words. A ping into a private thread the target has not
// joined would otherwise hand them the room's content, and a DirectMessage row
// outlives the ✕ that takes the message back.
//
// It goes through db/lib/dm.js rather than the gateway twin because the outbox
// has no discord.js client — it is a pg listener with a REST lane. The `»`
// prefix is that function's own, so the text passed here carries none.
//
// A CONCEALED send relays nothing at all. The room is not meant to know who
// spoke, and a DM naming the place would hand the target a thread to pull on.
async function relayWebMentions({ row, characters, concealed, channelId, messageId }) {
  if (concealed || characters.length === 0) return;
  const link = messageLink(channelId, messageId);
  if (!link) return;

  const [earshot, context, conversation] = await Promise.all([
    earshotForPlaceKey(prisma, row.placeKey),
    // The same zone/thread names the row itself was stamped with, so the DM
    // says the place the way /archive says it.
    archiveContextForPlaceKey(prisma, row.placeKey),
    // A mention only becomes an invite inside a Conversation, exactly as it
    // does on Discord (bot/src/events/messageCreate.js). A private Room is a
    // private thread too, but it is gated on a key tag (db/lib/roomAccess.js),
    // and letting a ping hand out a seat there would route around the lock.
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
      // The same contract /add has: the membership row first, the invite row
      // beside it so db/lib/threadInvites.js can replay the Discord add when
      // they walk in, and the Discord add now if they are already standing
      // here. A "web only" target has no Discord presence to add (CHAT.md §6)
      // — the row above is their invite and they read it on /chat.
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
    // And a browser notification, which is what reaches somebody whose /chat
    // tab is closed. After the DM, and wrapped: a push that will not send must
    // never cost the DM that already went (db/lib/webPush.js).
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
  content: true,
  source: true,
  discordMessageId: true,
  editedAt: true,
  deletedAt: true,
  discordSyncedAt: true,
};

// Is Discord behind on this row? `discordSyncedAt` is the watermark: an edit
// or a delete stamped after it has not been carried across yet.
function behind(stamp, syncedAt) {
  if (!stamp) return false;
  if (!syncedAt) return true;
  return new Date(stamp).getTime() > new Date(syncedAt).getTime();
}

// One row, posted. Returns true when Discord took it.
async function pushRow(row) {
  if (!row || row.source !== "WEB" || row.discordMessageId || row.deletedAt) return false;
  if (!row.characterId) return false;

  // Re-read the claim right before the post. The drain and a notification can
  // both pick a row up at startup, and the updateMany guard below only stops
  // the second CLAIM — by then the second post has already hit Discord.
  const fresh = await prisma.archiveEntry.findUnique({
    where: { id: row.id },
    select: { discordMessageId: true, deletedAt: true },
  });
  if (!fresh || fresh.discordMessageId || fresh.deletedAt) return false;

  const target = await targetFor(row.placeKey);
  if (!target) return false;

  const character = await prisma.character.findUnique({
    where: { id: row.characterId },
    // Exactly what presentedIdentity reads: `concealed` is the character's
    // own /conceal switch, `age`/`gender` build the concealed alias ("young
    // man"), and `updatedAt` is the avatar's cache-busting version.
    select: { id: true, name: true, concealed: true, age: true, gender: true, updatedAt: true },
  });
  if (!character) return false;

  const { forcedName, concealment } = await identityPiecesFor(character.id);

  // The row stores `{char:<id>}`; Discord reads `<@&roleId>`
  // (db/lib/characterMentions.js). Rewritten here rather than at write time,
  // so /chat and /archive keep the face-neutral text and only the copy
  // Discord receives wears Discord's spelling.
  const { content, characters } = await tokensToRoles(prisma, row.content);

  // The same answer postAsCharacter reaches internally, resolved here too
  // because the mention relay below turns on it. `alias` is the one field that
  // is set for BOTH a hood and a forced name, which is exactly the pair that
  // relays nothing.
  const identity = presentedIdentity(character, { forcedName, concealment });

  const posted = await postAsCharacter(target.channelId, character, content, {
    forcedName,
    concealment,
    threadId: target.threadId,
  });
  if (!posted?.id) return false;

  // updateMany, not update: the row may have been soft-deleted or already
  // claimed by the other path since it was read, and the guard makes this
  // idempotent rather than double-posting on a race.
  const claimed = await prisma.archiveEntry.updateMany({
    where: { id: row.id, discordMessageId: null },
    data: {
      discordMessageId: posted.id,
      discordChannelId: target.threadId ?? target.channelId,
      discordSyncedAt: new Date(),
    },
  });
  if (claimed.count === 0) return false;

  // After the claim, so a row that lost the race never DMs twice. Best-effort
  // like everything else on this path: a failed relay costs a notification,
  // never the message that already landed.
  await relayWebMentions({
    row,
    characters,
    concealed: Boolean(identity.alias),
    channelId: target.threadId ?? target.channelId,
    messageId: posted.id,
  }).catch((err) => console.error("Feed outbox mention relay failed:", err));

  return true;
}

// One row, edited on Discord. The row is the source of truth for the text
// now, so this runs for a ✏️ in Discord exactly as it does for a ✎ on /chat.
async function editRow(row) {
  if (!row?.discordMessageId || row.deletedAt) return false;

  // Re-read right before acting, the same guard the post path takes: two
  // edits in a row, or the drain racing a notification, would otherwise
  // both fire and the second would carry stale text.
  const fresh = await prisma.archiveEntry.findUnique({
    where: { id: row.id },
    select: { content: true, editedAt: true, deletedAt: true, discordSyncedAt: true, discordMessageId: true },
  });
  if (!fresh || fresh.deletedAt || !fresh.discordMessageId) return false;
  if (!behind(fresh.editedAt, fresh.discordSyncedAt)) return false;

  const target = await targetFor(row.placeKey);
  if (!target) return false;

  const webhook = await ensureChannelWebhook(target.channelId);
  // The same rewrite the post does: an edit that added a mention has to reach
  // Discord in Discord's spelling.
  const { content } = await tokensToRoles(prisma, fresh.content);
  await editWebhookMessage(webhook, fresh.discordMessageId, content, target.threadId);

  await prisma.archiveEntry.update({ where: { id: row.id }, data: { discordSyncedAt: new Date() } });
  return true;
}

// One row, deleted on Discord. The row itself stays — the delete is soft, so
// a browser holding it can reconcile — and `discordMessageId` stays with it so
// nothing ever reposts what somebody took back.
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
  // allow404 inside deleteWebhookMessage: a message a GM already removed by
  // hand is the outcome this was asking for.
  await deleteWebhookMessage(webhook, fresh.discordMessageId, target.threadId);

  await prisma.archiveEntry.update({ where: { id: row.id }, data: { discordSyncedAt: new Date() } });
  return true;
}

// The three verbs, chosen off the ROW rather than off the notification's
// `op`. The op is a hint about which one is likely; the row is the truth, and
// the drain has no op at all.
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

// Every row of the last day Discord is behind on — never posted, edited since
// it was posted, or taken back. Called on ready, so a message sent, edited or
// deleted while the bot was down still lands.
async function drainFeedOutbox() {
  try {
    // Scoped to the current game, not just to the last day. A row belonging to
    // a finished game must never be posted into today's channels, and `sentAt`
    // alone does not say that: a game archived and imported back reintroduces
    // rows whose timestamps are inside the window, and the drain would narrate
    // a dead game into the live map. The window is the freshness rule; this is
    // the identity one.
    const gameId = await currentGameId(prisma);
    const rows = await prisma.archiveEntry.findMany({
      where: {
        ...(gameId ? { gameId } : {}),
        sentAt: { gte: new Date(Date.now() - DRAIN_WINDOW_MS) },
        OR: [
          // Never posted: a web message written while the bot was down.
          { source: "WEB", discordMessageId: null, deletedAt: null },
          // Edited or taken back while the bot was down. `discordSyncedAt` is
          // the watermark; Prisma cannot compare two columns in a filter, so
          // the coarse "has one of the two stamps" test is done here and
          // syncRow's re-read settles it exactly.
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

// One pg client, not a Pool: LISTEN is a property of a single session, and a
// pooled connection can be handed to somebody else between notifications.
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
      // The payload carries seq as a string on purpose; a Number would lose
      // precision, and Prisma wants a BigInt for the column anyway.
      const seq = BigInt(parsed.seq);
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

// Called from ready. Never throws: a bot that cannot start the outbox is a
// bot whose web feed is one-way, not a bot that fails to come up.
async function startFeedOutbox() {
  stopped = false;
  await openListener().catch((err) => console.error("Feed outbox failed to start:", err));
  // Through the same queue the notifications use, so the drain and a row that
  // arrives while it runs never post side by side.
  await enqueue(drainFeedOutbox);
}

module.exports = { startFeedOutbox, drainFeedOutbox };
