// Channel-level REST helpers. Everything routes through core.js's
// discordRequest, so it sits behind the rate limiter and circuit breaker too.

const { discordRequest } = require("./core");

async function getGuildChannels() {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/channels`);
}

async function createChannel(payload) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/channels`, { method: "POST", body: payload });
}

async function patchGuildChannelPositions(updates) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/channels`, { method: "PATCH", body: updates });
}

async function getChannel(channelId, { allow404 = false } = {}) {
  return discordRequest(`/channels/${channelId}`, { allow404 });
}

async function deleteChannel(channelId) {
  return discordRequest(`/channels/${channelId}`, { method: "DELETE", allow404: true });
}

async function patchChannel(channelId, payload) {
  return discordRequest(`/channels/${channelId}`, { method: "PATCH", body: payload });
}

async function putChannelOverwrite(channelId, targetId, { allow = "0", deny = "0", type = 0 } = {}) {
  return discordRequest(`/channels/${channelId}/permissions/${targetId}`, {
    method: "PUT",
    body: { id: targetId, type, allow: String(allow), deny: String(deny) },
  });
}

// Removes an overwrite; falls back to the inherited permission. allow404
// because no-overwrite-here is success, not an error.
async function deleteChannelOverwrite(channelId, targetId) {
  return discordRequest(`/channels/${channelId}/permissions/${targetId}`, {
    method: "DELETE",
    allow404: true,
  });
}

module.exports = {
  getGuildChannels,
  createChannel,
  patchGuildChannelPositions,
  getChannel,
  deleteChannel,
  patchChannel,
  putChannelOverwrite,
  deleteChannelOverwrite,
};
