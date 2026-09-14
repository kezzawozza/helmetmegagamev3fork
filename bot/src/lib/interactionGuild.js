const { prisma } = require("@lifeweb/db");
const { gmRoleIds } = require("@lifeweb/db/lib/roleIds");

// Every player-facing command is registered globally with a BotDM context
// (see bot/src/lib/commands.js), so `interaction.guild` and
// `interaction.member` are null whenever one is run from the bot's DMs.
// Bascinet is single-guild, so the guild is recoverable from the environment —
// but no handler should reach for interaction.guild directly, or it works in
// a channel and throws in a DM.
//
// Returns { guild, member } with either possibly null: a null guild means
// DISCORD_GUILD_ID is unset or the bot is not in it, a null member means the
// player has left.
//
// DESTRUCTURE THE RESULT. The wrapper object is always truthy, so assigning it
// to a bare `member` and reading `.id` yields undefined rather than failing —
// and Prisma drops an undefined filter instead of matching nothing, so
// `where: { discordUserId: undefined, status: "ALIVE" }` quietly resolves to an
// ARBITRARY living character. That shipped twice; use actingCharacter() below
// rather than writing the lookup by hand a third time. db/lib/parties.js
// carries the same warning for the same reason.
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

// The GM gate. interaction.member is null in a DM, which would silently read
// as "not a GM" — that is the right answer (no GM command is DM-able, see
// commands.js), but it should be a decision rather than an accident.
function isGmMember(interaction) {
  if (!interaction.inGuild()) return false;
  const roles = interaction.member?.roles.cache;
  if (!roles) return false;
  // Either seat: gmRoleIds() carries the Gamemaster role and the Trial one.
  return gmRoleIds().some((id) => roles.has(id));
}

// The falsy guard is the whole point: without it an absent id resolves to
// whichever living character the database hands back first.
async function findAliveCharacter(discordUserId, args = {}) {
  if (!discordUserId) return null;
  return prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    ...args,
  });
}

// The acting character, resolved from the interaction rather than from anything
// the client sent. `args` carries the caller's own select/include. Null when the
// guild or member is unreachable, or the player has no living character.
async function actingCharacter(interaction, args = {}) {
  const { member } = await resolveActingMember(interaction);
  if (!member?.id) return null;
  return prisma.character.findFirst({
    where: { discordUserId: member.id, status: "ALIVE" },
    ...args,
  });
}

module.exports = { resolveActingMember, isGmMember, findAliveCharacter, actingCharacter };
