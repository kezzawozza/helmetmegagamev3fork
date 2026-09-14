// Webhook-level REST helpers: the tupper webhook cache, executing/editing/
// deleting webhook messages, and postAsCharacter, the REST twin of the bot's
// proxy that posts player-authored text as a character.

const { chunkMessage } = require("../chunkText");
const { presentedIdentity } = require("../presentedIdentity");
const { discordRequest } = require("./core");

const WEBHOOK_NAME = "Bascinet Tupper";

// Discord JSON error code for a webhook that no longer exists.
const UNKNOWN_WEBHOOK = 10015;

// REST twin of bot/src/lib/proxy.js#fetchOrCreateWebhook — reuse the bot's
// webhook on a channel, create one only if there isn't one. Cached per
// channel for the process lifetime so a per-character loop isn't a GET each.
const webhookCache = new Map();

function forgetChannelWebhook(channelId) {
  webhookCache.delete(channelId);
}

async function ensureChannelWebhook(channelId) {
  const cached = webhookCache.get(channelId);
  if (cached) return cached;

  const webhook = await fetchOrCreateChannelWebhook(channelId);
  webhookCache.set(channelId, webhook);
  return webhook;
}

async function fetchOrCreateChannelWebhook(channelId) {
  const existing = await discordRequest(`/channels/${channelId}/webhooks`);
  const mine = existing?.find((w) => w.token);
  if (mine) return { id: mine.id, token: mine.token };

  const created = await discordRequest(`/channels/${channelId}/webhooks`, {
    method: "POST",
    body: { name: WEBHOOK_NAME },
  });
  return { id: created.id, token: created.token };
}

// `auth: false`: the webhook token in the URL IS the credential — a bot auth
// header alongside it can make Discord reject the request. Bucketed at
// roughly 5 per 5 seconds per channel, so a 429 here is routine.
// `threadId` is how a webhook posts into a thread: the webhook itself belongs
// to the PARENT channel (Discord will not create one on a thread), and the
// execute call names the thread in the query. `wait=true` stays either way —
// without it Discord answers 204 and the outbox never learns the message id it
// has to store to be able to edit or delete the message later.
async function executeWebhook({ id, token }, { content, username, avatarUrl, threadId = null }) {
  const query = threadId ? `?wait=true&thread_id=${threadId}` : "?wait=true";
  return discordRequest(`/webhooks/${id}/${token}${query}`, {
    method: "POST",
    auth: false,
    body: {
      content,
      username,
      avatar_url: avatarUrl,
      // Never let player-authored text ping a role or @everyone by typing it.
      allowed_mentions: { parse: ["users"] },
    },
  });
}

// Editing and deleting a webhook message need the thread id too, for the same
// reason: without it Discord looks the message up in the parent channel, does
// not find it, and 404s. Both are what bot/src/lib/feedOutbox.js uses — since
// phase 1 the outbox is the ONLY thing that edits or deletes a proxied
// message, on either face.
async function editWebhookMessage({ id, token }, messageId, content, threadId = null) {
  const query = threadId ? `?thread_id=${threadId}` : "";
  return discordRequest(`/webhooks/${id}/${token}/messages/${messageId}${query}`, {
    method: "PATCH",
    auth: false,
    body: { content, allowed_mentions: { parse: ["users"] } },
  });
}

// allow404: a message somebody already removed by hand is the outcome this
// was asking for, not an error.
async function deleteWebhookMessage({ id, token }, messageId, threadId = null) {
  const query = threadId ? `?thread_id=${threadId}` : "";
  return discordRequest(`/webhooks/${id}/${token}/messages/${messageId}${query}`, {
    method: "DELETE",
    auth: false,
    allow404: true,
  });
}

// REST equivalent of a tupper proxy. Chunked, since its one caller posts
// player-authored text that can exceed 2000 chars, and it returns the FIRST
// message — what the archive anchors to. `forcedName` (Tag.forcedName) and
// `concealment` (loadConcealment) are both resolved by the CALLER, which has a
// prisma handle; this module deliberately has none. See
// db/lib/presentedIdentity.js. `threadId` posts into a Room or Conversation
// thread under `channelId`, and the webhook is still the parent channel's —
// see executeWebhook.
//
// The REST twin of bot/src/lib/proxy.js#postAsCharacterTo, so it has to reach
// the same answer that one does: forced > concealed > own. `character` must
// therefore carry the columns presentedIdentity reads — `concealed`, `age`,
// `gender`, `name`, `updatedAt` — which is what the caller selects
// (bot/src/lib/feedOutbox.js#pushRow).
//
// It used to keep a concealment only when it FORCED itself, and override the
// column to match, on this argument: an auto-filed summary should ignore
// /conceal, because going unnamed in conversation says nothing about the
// paperwork — while it must NOT ignore forced concealment, because that is no
// choice, and a character with a sack over their head filing a report under
// their own name and face would hand back exactly the identity the sack took
// away. The argument is sound and this was never the place for it: there has
// been no auto-filing caller since the function was written. The only one is
// the relay that carries every line typed on /chat to Discord — so what the
// rule actually did was let a voluntary hood resolve correctly into the
// archive row and then post that line to the channel under the speaker's real
// name and real face. The hood worked on /chat and did nothing on Discord.
//
// If game-composed text ever needs that behaviour, it belongs at the caller,
// which is the only thing that knows what it is filing.
async function postAsCharacter(channelId, character, content, { forcedName = null, concealment = null, threadId = null } = {}) {
  const chunks = chunkMessage(String(content ?? ""));
  if (chunks.length <= 1) return postAsCharacterChunk(channelId, character, content, forcedName, concealment, threadId);

  let first = null;
  for (const chunk of chunks) {
    const sent = await postAsCharacterChunk(channelId, character, chunk, forcedName, concealment, threadId);
    if (!first) first = sent;
  }
  return first;
}

async function postAsCharacterChunk(channelId, character, content, forcedName, concealment, threadId = null) {
  try {
    return await postAsCharacterOnce(channelId, content, character, forcedName, concealment, threadId);
  } catch (err) {
    // Keyed on the error CODE, never message text — a 429 shouldn't rebuild.
    if (err.discordCode === UNKNOWN_WEBHOOK || err.status === 404) {
      forgetChannelWebhook(channelId);
      return postAsCharacterOnce(channelId, content, character, forcedName, concealment, threadId);
    }
    throw err;
  }
}

async function postAsCharacterOnce(channelId, content, character, forcedName, concealment = null, threadId = null) {
  const webhook = await ensureChannelWebhook(channelId);
  const base = process.env.WEB_BASE_URL;
  const identity = presentedIdentity(character, { forcedName, concealment });
  return executeWebhook(webhook, {
    content,
    username: identity.name,
    avatarUrl: base ? `${base}${identity.avatarPath}` : undefined,
    threadId,
  });
}

module.exports = {
  ensureChannelWebhook,
  executeWebhook,
  editWebhookMessage,
  deleteWebhookMessage,
  postAsCharacter,
};
