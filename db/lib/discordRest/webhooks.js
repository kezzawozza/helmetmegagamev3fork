// Webhook-level REST helpers: the tupper webhook cache, executing/editing/deleting webhook messages, and postAsCharacter.

const { chunkMessage } = require("../chunkText");
const { presentedIdentity } = require("../presentedIdentity");
const { concealDiscriminator } = require("../concealedDiscriminator");
const { discordRequest } = require("./core");

const WEBHOOK_NAME = "Bascinet Tupper";

// Discord JSON error code for a webhook that no longer exists.
const UNKNOWN_WEBHOOK = 10015;

// REST twin of bot/src/lib/proxy.js#fetchOrCreateWebhook. Cached per channel for process lifetime.
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

// `auth: false`: the webhook token in the URL IS the credential — a bot auth header alongside it can make Discord reject the request.
// `threadId` names the thread in the query since the webhook itself belongs to the parent channel. `wait=true` stays either way, or Discord answers 204 with no message id to store for later edit/delete.
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

// Editing/deleting need the thread id too, or Discord looks in the parent channel and 404s. Used by bot/src/lib/feedOutbox.js.
async function editWebhookMessage({ id, token }, messageId, content, threadId = null) {
  const query = threadId ? `?thread_id=${threadId}` : "";
  return discordRequest(`/webhooks/${id}/${token}/messages/${messageId}${query}`, {
    method: "PATCH",
    auth: false,
    body: { content, allowed_mentions: { parse: ["users"] } },
  });
}

// allow404: a message already removed by hand is not an error.
async function deleteWebhookMessage({ id, token }, messageId, threadId = null) {
  const query = threadId ? `?thread_id=${threadId}` : "";
  return discordRequest(`/webhooks/${id}/${token}/messages/${messageId}${query}`, {
    method: "DELETE",
    auth: false,
    allow404: true,
  });
}

// REST twin of bot/src/lib/proxy.js#postAsCharacterTo: forced > concealed > own. Chunked (returns the FIRST message, what the archive anchors to).
// `forcedName`/`concealment` are resolved by the CALLER (this module has no prisma handle) — see db/lib/presentedIdentity.js. `character` must carry
// `concealed`, `age`, `gender`, `name`, `updatedAt` (bot/src/lib/feedOutbox.js#pushRow). `threadId` posts into a Room/Conversation thread; webhook stays the parent channel's.
//
// `displayName` overrides the NAME only, never the face. One caller: a Deadchat row, whose name was
// composed and frozen at send time ("Solomon Baker (Pub Fries)") and must not be re-derived here —
// re-deriving would drop the account half and re-apply a hood the corpse is still wearing. The
// avatar still resolves off the character, which is how a ghost keeps the face they had in game.
//
// `turnNumber`/`placeKey` scope the invisible discriminator that keeps two hooded characters
// sharing an alias from collapsing into one Discord block (db/lib/concealedDiscriminator.js).
// Applied only on a concealed send; the archive keeps the plain alias.
async function postAsCharacter(channelId, character, content, { forcedName = null, concealment = null, threadId = null, displayName = null, turnNumber = null, placeKey = null } = {}) {
  const chunks = chunkMessage(String(content ?? ""));
  const opts = { forcedName, concealment, threadId, displayName, turnNumber, placeKey };
  if (chunks.length <= 1) return postAsCharacterChunk(channelId, character, content, opts);

  let first = null;
  for (const chunk of chunks) {
    const sent = await postAsCharacterChunk(channelId, character, chunk, opts);
    if (!first) first = sent;
  }
  return first;
}

async function postAsCharacterChunk(channelId, character, content, opts) {
  try {
    return await postAsCharacterOnce(channelId, content, character, opts);
  } catch (err) {
    // Keyed on the error CODE, never message text — a 429 shouldn't rebuild.
    if (err.discordCode === UNKNOWN_WEBHOOK || err.status === 404) {
      forgetChannelWebhook(channelId);
      return postAsCharacterOnce(channelId, content, character, opts);
    }
    throw err;
  }
}

// Discord caps a webhook username at 80 characters. Both halves of a composed Deadchat name are
// user-controlled, so it is truncated here rather than trusted to be short. Truncation runs BEFORE
// the discriminator so a very long Deadchat name never eats the zero-width suffix.
const USERNAME_LIMIT = 80;

async function postAsCharacterOnce(channelId, content, character, opts) {
  const { forcedName, concealment, threadId, displayName, turnNumber, placeKey } = opts;
  const webhook = await ensureChannelWebhook(channelId);
  const base = process.env.WEB_BASE_URL;
  const identity = presentedIdentity(character, { forcedName, concealment });
  const displayed = (displayName ?? identity.name).slice(0, USERNAME_LIMIT);
  const username = identity.concealed
    ? `${displayed}${concealDiscriminator({ characterId: character.id, turnNumber, placeKey })}`
    : displayed;
  return executeWebhook(webhook, {
    content,
    username,
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
