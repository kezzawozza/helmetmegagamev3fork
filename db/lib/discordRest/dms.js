// DM channel helpers: open/cache the DM channel with a user, and post into
// it (single message or chunked-batched).

const { chunkMessage } = require("../chunkText");
const { discordRequest } = require("./core");
const { postMessage } = require("./messages");

// Opens (or returns the cached) DM channel with a user. A real POST every
// time otherwise — the id is stable for the guild's lifetime, so caching it
// avoids reopening it per player per turn.
const dmChannelCache = new Map(); // discordUserId -> channelId

function forgetDmChannel(discordUserId) {
  dmChannelCache.delete(discordUserId);
}

async function createDmChannel(discordUserId) {
  const cached = dmChannelCache.get(discordUserId);
  if (cached) return { id: cached };

  const channel = await discordRequest("/users/@me/channels", {
    method: "POST",
    body: { recipient_id: discordUserId },
  });
  if (channel?.id) dmChannelCache.set(discordUserId, channel.id);
  return channel;
}

// Discord JSON error code for a channel it no longer recognises.
const UNKNOWN_CHANNEL = 10003;

// `extras` is { components, embeds }, both optional.
// `allowedMentions` rides through for the same reason postMessage takes one:
// a DM that carries text a PLAYER typed must not be able to ping the room.
// Omitted, Discord parses everything in the string.
async function postDmOnce(discordUserId, content, extras = {}) {
  const { components, embeds, allowedMentions } = extras ?? {};
  const channel = await createDmChannel(discordUserId);
  try {
    return await postMessage(channel.id, content, components, allowedMentions, embeds);
  } catch (err) {
    if (err.discordCode !== UNKNOWN_CHANNEL && err.status !== 404) throw err;
    forgetDmChannel(discordUserId);
    const fresh = await createDmChannel(discordUserId);
    return postMessage(fresh.id, content, components, allowedMentions, embeds);
  }
}

// DM equivalent of postMessageBatched. The `»` prefix (applied by the
// caller) lands only on the first chunk; `components` and `embeds` ride the
// LAST chunk only, or Discord renders one live row (or one card) per chunk.
async function postDmBatched(discordUserId, text, extras = {}) {
  const chunks = chunkMessage(text);
  if (chunks.length === 0) chunks.push(text);

  let sent = null;
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    sent = await postDmOnce(
      discordUserId,
      chunks[i],
      // components and embeds ride the last chunk only, or Discord draws one
      // live row per chunk. allowedMentions rides EVERY chunk: a ping in an
      // early one would otherwise go out unmuzzled.
      last ? extras : { allowedMentions: extras?.allowedMentions },
    );
  }
  return sent;
}

module.exports = {
  createDmChannel,
  forgetDmChannel,
  postDmBatched,
};
