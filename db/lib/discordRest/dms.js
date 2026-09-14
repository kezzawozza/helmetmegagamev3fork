const { chunkMessage } = require("../chunkText");
const { discordRequest } = require("./core");
const { postMessage } = require("./messages");

// Cached DM channel id, stable for the guild's lifetime — avoids a real POST to reopen it per player per turn.
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

// `allowedMentions` rides through for the same reason postMessage takes one: a DM that carries text a PLAYER typed must not be able to ping the room.
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

// DM equivalent of postMessageBatched. `components`/`embeds` ride the LAST chunk only, or Discord renders one live row per chunk.
async function postDmBatched(discordUserId, text, extras = {}) {
  const chunks = chunkMessage(text);
  if (chunks.length === 0) chunks.push(text);

  let sent = null;
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    sent = await postDmOnce(
      discordUserId,
      chunks[i],
      // allowedMentions rides EVERY chunk: a ping in an early one would otherwise go out unmuzzled.
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
