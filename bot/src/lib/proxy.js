const { WebhookClient, RESTJSONErrorCodes, GuildPremiumTier } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { loadForcedName, presentedIdentity, wasHooded } = require("@lifeweb/db/lib/presentedIdentity");
const { archiveRowForMessage, retractArchiveRow } = require("@lifeweb/db/lib/archive");
const { touchCharacterActivity, touchLastSeen } = require("@lifeweb/db/lib/characterActivity");
const { prepareSpeech, recordSpeech, loadVoiceState: loadVoiceStateFor } = require("@lifeweb/db/lib/say");
const { placeKeyForChannel } = require("@lifeweb/db/lib/placeKey");
const { resolveChannelContext } = require("./channels");
const { sendDm } = require("./dm");
const { DM_KIND } = require("@lifeweb/db/lib/dmKinds");

const WEBHOOK_NAME = "Bascinet Tupper";

// webhookCache: channelId -> { id, token }. clientCache: webhookId ->
// WebhookClient, kept because a fresh client starts rate-limit-blind
// against a ~5-per-5s bucket.
const webhookCache = new Map();
const clientCache = new Map();

// Guards a cold channel hit by two messages in the same tick from running
// fetchWebhooks twice and creating two webhooks.
const webhookPending = new Map(); // channelId -> Promise<{ id, token }>

// Returns the WebhookClient for a webhook, building it at most once.
function webhookClientFor({ id, token }) {
  const cached = clientCache.get(id);
  if (cached) return cached;
  const client = new WebhookClient({ id, token });
  clientCache.set(id, client);
  return client;
}

// Un-learn a channel's webhook (e.g. after a GM deletes it), so proxying
// recovers instead of breaking until the next restart.
function forgetChannelWebhook(channelId) {
  const info = webhookCache.get(channelId);
  webhookCache.delete(channelId);
  webhookPending.delete(channelId);
  if (info) {
    clientCache.get(info.id)?.destroy?.();
    clientCache.delete(info.id);
  }
}

function webhookChannelFor(channel) {
  return channel.isThread() ? channel.parent : channel;
}

async function fetchOrCreateWebhook(channel) {
  const target = webhookChannelFor(channel);
  const cached = webhookCache.get(target.id);
  if (cached) return cached;

  const inflight = webhookPending.get(target.id);
  if (inflight) return inflight;

  const pending = (async () => {
    const webhooks = await target.fetchWebhooks();
    let webhook = webhooks.find((w) => w.owner?.id === channel.client.user.id);
    if (!webhook) {
      webhook = await target.createWebhook({ name: WEBHOOK_NAME });
    }

    const info = { id: webhook.id, token: webhook.token };
    webhookCache.set(target.id, info);
    return info;
  })();

  webhookPending.set(target.id, pending);
  try {
    return await pending;
  } finally {
    webhookPending.delete(target.id);
  }
}

// Attachments are recorded as a placeholder, not the CDN url — Discord's
// links expire, so the archive would fill with dead images.
function attachmentPlaceholders(message) {
  return [...(message.attachments?.values() ?? [])].map((a) =>
    a.contentType?.startsWith("image/") ? "[image]" : "[attachment]",
  );
}

// The speech gate moved to db/lib/say.js#loadVoiceState in phase 1, so the
// web and Discord ask it the same question. Kept here as a one-argument
// wrapper because three bot handlers already call it that way.
function loadVoiceState(characterId) {
  return loadVoiceStateFor(prisma, characterId);
}

// The core send: post `content` (and any files) into `channel` as
// `character`. Takes no Message — the Speak modal has no source message, only
// an interaction.
//
// Since phase 1 this is a POSTER and nothing else. The speech gate, the
// babble pass, the autocorrect pass and the length check all live in
// db/lib/say.js#prepareSpeech, which every caller runs first; the tracking
// map it used to write is gone, because a reaction looks its message up in
// ArchiveEntry now (PROXYING.md §2) and a database row outlives a restart.
//
// `identity` is the resolved presentedIdentity(character, ...) — forced >
// concealed > own name (db/lib/presentedIdentity.js). A caller that passes
// none gets the plain one rather than a crash on the hottest path in the bot.
async function postAsCharacterTo(channel, character, { content, files = [], identity = presentedIdentity(character) }) {
  const threadId = channel.isThread() ? channel.id : undefined;

  const payload = {
    content,
    username: identity.name,
    avatarURL: process.env.WEB_BASE_URL ? `${process.env.WEB_BASE_URL}${identity.avatarPath}` : undefined,
    files,
    threadId,
    // Role mentions render but never notify — character-role pings are
    // relayed as a DM instead (bot/src/lib/mentions.js). Matches
    // db/lib/discordRest.js#executeWebhook.
    allowedMentions: { parse: ["users"] },
  };

  const send = async () => {
    const info = await fetchOrCreateWebhook(channel);
    return webhookClientFor(info).send(payload);
  };

  let webhookMessage;
  try {
    webhookMessage = await send();
  } catch (err) {
    // Only rebuild for a webhook Discord no longer has — retrying a 429
    // makes it worse.
    if (err.code !== RESTJSONErrorCodes.UnknownWebhook) throw err;
    forgetChannelWebhook(webhookChannelFor(channel).id);
    webhookMessage = await send();
  }

  return { webhookMessage, content };
}

// What a reaction knows about the message it landed on, read out of the
// transcript rather than an in-memory map. This is what retired
// `recentProxies`: a bot restart used to make every older message inert to
// ✏️ ❌ 🔍 📸, and a row does not forget.
//
// `concealed` cannot be read straight off `concealedAlias`, because the column
// holds a FORCED name too and a forced identity is not a concealed one.
// presentedIdentity.js#wasHooded settles it from what the row froze at send
// time. The current forced name goes along as its tiebreaker only — on its own
// it was wrong the moment the name expired, which for a Disguise Kit is three
// turns in.
async function proxyRowFor(discordMessageId) {
  const row = await archiveRowForMessage(prisma, discordMessageId);
  if (!row || row.kind !== "MESSAGE" || !row.characterId) return null;

  const character = await prisma.character.findUnique({
    where: { id: row.characterId },
    select: { discordUserId: true },
  });

  // Short-circuited on the column, so an ordinary line costs no extra query.
  const concealed = row.concealedAlias
    ? wasHooded(row, { forcedName: await loadForcedName(prisma, row.characterId) })
    : false;

  return {
    seq: row.seq,
    sentAt: row.sentAt,
    deletedAt: row.deletedAt,
    content: row.content,
    characterId: row.characterId,
    discordUserId: character?.discordUserId ?? null,
    alias: row.concealedAlias,
    // The face the room saw beside that alias, for whoever needs to freeze it
    // a second time — ⭐ files it onto the Note (Note.presentedAvatarPath).
    avatarPath: row.presentedAvatarPath ?? null,
    concealed,
  };
}

const DM_CHUNK = 1900;

// Discord's per-file upload ceiling for this guild, derived from boost tier
// (discord.js doesn't expose it directly).
function uploadLimitBytes(guild) {
  switch (guild?.premiumTier) {
    case GuildPremiumTier.Tier2:
      return 50 * 1024 * 1024;
    case GuildPremiumTier.Tier3:
      return 100 * 1024 * 1024;
    default:
      return 10 * 1024 * 1024;
  }
}

// What, if anything, makes this message impossible to repost as a webhook.
// Checked before sending.
function proxyRefusal(message, content) {
  const text = content ?? "";

  const limit = uploadLimitBytes(message.guild);
  const tooBig = [...message.attachments.values()].find((a) => a.size > limit);
  if (tooBig) {
    return (
      `${tooBig.name} is bigger than the ${Math.round(limit / 1024 / 1024)} MB the bot can repost. ` +
      "Your text is below — send it again without that file."
    );
  }

  // A sticker-only or effect-only message arrives empty; the webhook would
  // reject it.
  if (!text.trim() && message.attachments.size === 0) {
    return "There was nothing in that the bot could repost. Stickers and Discord's own effects don't survive being proxied.";
  }

  return null;
}

// Deleting the original keeps a player's real account off the screen.
async function deleteOriginal(message) {
  try {
    await message.delete();
  } catch (err) {
    console.error(`Failed to delete the original message ${message.id} after proxying:`, err);
  }
}

// Gives the player their words back after a refusal. Sent in pieces since
// the commonest refusal is the message being too long for one DM too.
async function handBack(message, reason, text) {
  try {
    await sendDm(message.author, `» *${reason}*`, { kind: DM_KIND.QUIET });
    const body = (text ?? "").trim();
    for (let i = 0; i < body.length; i += DM_CHUNK) {
      await sendDm(message.author, body.slice(i, i + DM_CHUNK), { kind: DM_KIND.QUIET });
    }
  } catch (err) {
    console.error(`Couldn't return the unproxied message to ${message.author.id}:`, err);
  }
}

// The message-driven path: proxy what a player typed in a tupper channel,
// then delete their original. The original is deleted on every path,
// including failing ones — a message left under a real Discord name breaks
// the character/account separation the game depends on. Returns null when
// the message could not be proxied.
//
// Three calls since phase 1, and the order is the whole point:
// prepareSpeech decides, postAsCharacterTo posts, recordSpeech writes the row
// with the id it got back. The web takes the same two halves the other way
// round (row first, outbox posts after), which is what makes them one path
// rather than two that agree for now.
async function sendAsCharacter(channel, character, message, { identity: _identity = null, content: override = null, ghost = false } = {}) {
  const text = override ?? message.content;

  // Both of these used to sit outside any handler, and the only catch above
  // them — messageCreate.js's — just logs and returns. So a database hiccup
  // while working out the place or resolving the identity left the player's
  // raw message sitting in the channel under their real Discord name, with
  // nothing said to them: the exact failure the header above promises cannot
  // happen. Deleting and handing back is the answer here as everywhere else.
  let prepared;
  try {
    // What the row will be filed under. Memoised in placeKey.js, so this costs
    // nothing on the hot path once the channel is warm.
    const placeKey = await placeKeyForChannel(prisma, {
      channelId: channel.id,
      parentId: channel.parent?.id,
    });

    // The gates, the transforms and the identity, in one call.
    prepared = await prepareSpeech(prisma, {
      character,
      placeKey,
      content: text,
      source: "DISCORD",
      ghost,
    });
  } catch (err) {
    console.error("Failed to prepare a message for proxying, returning it to its author:", err);
    await deleteOriginal(message);
    await handBack(message, "Something went wrong reposting that. Here's your message:", text);
    return null;
  }
  if (!prepared.ok) {
    await deleteOriginal(message);
    await handBack(message, prepared.refusal, text);
    return null;
  }

  // What is left here needs the Message itself — an oversized attachment, a
  // sticker-only post — so it cannot live in db/lib with the rest.
  const refusal = proxyRefusal(message, prepared.content);
  if (refusal) {
    await deleteOriginal(message);
    await handBack(message, refusal, text);
    return null;
  }

  // THE ROW COMES FIRST, and it is a claim as much as a record.
  //
  // This used to run the other way round — post, then record, then delete the
  // original — and both halves of that order were wrong. Nothing was keyed on
  // the player's own message id, so a redelivered `messageCreate` (a gateway
  // RESUME race, a reconnect mid-handler) ran the whole thing twice: two
  // webhook posts, two rows, and the second deleteOriginal quietly no-opping on
  // an already-deleted message. ArchiveEntry.discordMessageId is unique, but it
  // holds the WEBHOOK's id, minted fresh per run, so it never collided and
  // never helped. One typed line went out twice that way.
  //
  // Writing first turns the unique index on `sourceDiscordMessageId` into the
  // gate: the second delivery loses the race here and returns before Discord is
  // touched at all. It also closes the other hole in the old order — a failed
  // archive write was swallowed AFTER the post had succeeded, leaving a message
  // in Discord with no row, invisible on the website for good.
  //
  // Safe against the outbox posting it a second time: feedOutbox.js#pushRow and
  // the drain both require `source === "WEB"`, and this row is DISCORD.
  let row;
  try {
    row = await recordSpeech(prisma, prepared, {
      sourceDiscordMessageId: message.id,
      // Stamped after the post lands, below.
      discordMessageId: null,
      // prepared.rowContent, not prepared.content: the webhook below gets
      // Discord's `<@&roleId>` spelling and the ROW keeps the face-neutral
      // `{char:<id>}` one (db/lib/characterMentions.js, PROXYING.md §6).
      content: [prepared.rowContent ?? prepared.content, ...attachmentPlaceholders(message)]
        .filter(Boolean)
        .join("\n"),
      ...resolveChannelContext(channel),
      // Let P2002 through; everything else about archive writes still swallows.
      rethrow: true,
    });
  } catch (err) {
    if (err?.code === "P2002") {
      // Already proxied. Delete the original in case the first run has not got
      // that far, and say nothing to the player — from where they sit their
      // message posted once, which is the truth.
      console.warn(`Duplicate messageCreate for ${message.id}; already proxied.`);
      await deleteOriginal(message);
      return null;
    }
    // We could not record it, so we will not post it. Handing it back is the
    // honest answer: the old behaviour posted anyway and lost the row, which is
    // how a message ends up on Discord and nowhere else.
    console.error("Failed to record message, returning it to its author:", err);
    await deleteOriginal(message);
    await handBack(message, "Something went wrong reposting that. Here's your message:", text);
    return null;
  }

  let webhookMessage;
  try {
    ({ webhookMessage } = await postAsCharacterTo(channel, character, {
      content: prepared.content,
      files: [...message.attachments.values()].map((a) => a.url),
      identity: prepared.identity,
    }));
  } catch (err) {
    console.error("Failed to proxy message, returning it to its author:", err);
    // The row's insert has already fired its NOTIFY, so a web client may be
    // showing this line. Take it back the way any deletion is taken back
    // rather than dropping the row, or that tab keeps a message Discord never
    // heard.
    if (row?.id) await retractArchiveRow(prisma, row.id);
    await deleteOriginal(message);
    await handBack(message, "Something went wrong reposting that. Here's your message:", text);
    return null;
  }

  // Both halves of a forced or concealed send are already on the row: alias is
  // what the room saw, character.name is who it was. All that is left is to
  // point it at the message Discord actually took.
  //
  // updateMany with a `discordMessageId: null` guard, the same shape
  // feedOutbox.js uses for its own claim: idempotent if anything else got here
  // first, rather than overwriting a live id.
  if (row?.id) {
    await prisma.archiveEntry.updateMany({
      where: { id: row.id, discordMessageId: null },
      data: { discordMessageId: webhookMessage.id, discordSyncedAt: new Date() },
    });
  }
  await touchCharacterActivity(prisma, character.id);
  await touchLastSeen(prisma, character.discordUserId);

  await deleteOriginal(message);

  return webhookMessage;
}

module.exports = {
  loadVoiceState,
  // For bot/src/lib/messageCatchUp.js, which files a recovered message's
  // attachments the same way the live path does rather than losing them.
  attachmentPlaceholders,
  proxyRowFor,
  sendAsCharacter,
  postAsCharacterTo,
  fetchOrCreateWebhook,
  forgetChannelWebhook,
};
