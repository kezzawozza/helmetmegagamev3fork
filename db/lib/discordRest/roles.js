// Role and guild-member REST helpers, all routed through discordRequest so
// they sit behind the circuit breaker too. `type` 0 = role, 1 = member.

const { discordRequest } = require("./core");

async function getGuildRoles() {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/roles`);
}

async function createGuildRole(payload) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/roles`, { method: "POST", body: payload });
}

async function patchGuildRole(roleId, payload) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/roles/${roleId}`, { method: "PATCH", body: payload });
}

async function deleteGuildRole(roleId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/roles/${roleId}`, { method: "DELETE", allow404: true });
}

// allow404: a player who left the guild between the DB read and this call
// is a fact to reconcile later, not a reason to abort the loop.
async function addMemberRole(userId, roleId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: "PUT",
    allow404: true,
  });
}

async function removeMemberRole(userId, roleId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: "DELETE",
    allow404: true,
  });
}

// One member, or null if they've left — cheaper than letting a DM-channel
// create for a departed user 403 into the breaker's tally.
async function getGuildMember(userId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/members/${userId}`, { allow404: true });
}

// Paginates the full member list (1000/page). Each entry carries
// { user: { id, ... }, roles: [...] }, what the channel doctor diffs.
async function listGuildMembers() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const members = [];
  let after = "0";
  for (;;) {
    const page = await discordRequest(`/guilds/${guildId}/members?limit=1000&after=${after}`);
    members.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return members;
}

module.exports = {
  getGuildRoles,
  createGuildRole,
  patchGuildRole,
  deleteGuildRole,
  addMemberRole,
  removeMemberRole,
  getGuildMember,
  listGuildMembers,
};
