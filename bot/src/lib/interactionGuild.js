const { prisma } = require("@lifeweb/db");
const { gmRoleIds } = require("@lifeweb/db/lib/roleIds");

// `interaction.guild`/`interaction.member` are null from a DM (BotDM context, commands.js).
// Returns { guild, member }, either possibly null. DESTRUCTURE THE RESULT: a bare `member.id` off
// the wrapper is undefined, and Prisma drops an undefined filter rather than matching nothing — an
// ARBITRARY living character comes back. Use actingCharacter() below instead. db/lib/parties.js carries the same warning.
async function resolveActingMember(interaction) {
  const guild =
    interaction.guild ??
    interaction.client.guilds.cache.get(process.env.DISCORD_GUILD_ID) ??
    null;
  if (!guild) return { guild: null, member: null };

  const member =
    (interaction.guild ? interaction.member : null) ??
    guild.members.cache.get(interaction.user.id) ??
    (await guild.members.fetch(interaction.user.id).catch(() => null));

  return { guild, member };
}

// interaction.member is null in a DM, which reads as "not a GM" — the right answer (commands.js).
function isGmMember(interaction) {
  if (!interaction.inGuild()) return false;
  const roles = interaction.member?.roles.cache;
  if (!roles) return false;
  return gmRoleIds().some((id) => roles.has(id)); // Gamemaster or Trial seat
}

// The falsy guard: without it an absent id resolves to whichever living character comes back first.
async function findAliveCharacter(discordUserId, args = {}) {
  if (!discordUserId) return null;
  return prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    ...args,
  });
}

// Resolved from the interaction, never from anything the client sent. Null when unreachable.
async function actingCharacter(interaction, args = {}) {
  const { member } = await resolveActingMember(interaction);
  if (!member?.id) return null;
  return prisma.character.findFirst({
    where: { discordUserId: member.id, status: "ALIVE" },
    ...args,
  });
}

module.exports = { resolveActingMember, isGmMember, findAliveCharacter, actingCharacter };
