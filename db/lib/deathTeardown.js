// The DISCORD half of a character's death — the twin of db/lib/characterDeath.js, which owns the
// database half. ORDER MATTERS: revoke the overwrites while the role still names them, then delete
// the role, then clear the nickname, then hand over the Deadchat seat (db/lib/deadchat.js — a
// per-member overwrite on one channel, not a role; the Ghost role it replaces printed "dead" on a
// profile card). REST only, never inside a
// transaction (ARCHITECTURE.md §5); every step is wrapped — a death must not be undone by a 429.
// Takes `prisma` first, off the @lifeweb/db barrel (db/lib/dm.js convention).
const { deleteGuildRole, setGuildNickname, getGuildMember } = require("./discordRest");
const { revokeAllCharacterAccess } = require("./accessSweep");
const { openDeadchatTo } = require("./deadchat");

// `character` needs only { id, name, discordUserId, discordRoleId } — the role id must be READ BEFORE
// applyDeathToRow nulls the column. Whether this PERSON still has a living character: keys on
// `discordUserId`, not the character row, since Metempsychosis (db/lib/reincarnate.js) can place a
// reborn character seconds before this would otherwise ghost/un-nickname/lock them out.
async function stillAlive(prisma, discordUserId) {
  if (!discordUserId) return false;
  const living = await prisma.character
    .count({ where: { discordUserId, status: "ALIVE" } })
    .catch(() => 0);
  return living > 0;
}

async function applyDeathTeardown(prisma, character) {
  const log = (what) => (err) => console.error(`Death teardown: ${what} failed:`, err?.message ?? err);

  // The corpse's own role still goes, but nothing that strips the PERSON runs while alive again.
  const reborn = await stillAlive(prisma, character.discordUserId);

  if (!reborn) {
    await revokeAllCharacterAccess(prisma, character).catch(log(`revoke for ${character.name}`));
  }

  if (character.discordRoleId) {
    await deleteGuildRole(character.discordRoleId).catch(log(`role delete for ${character.name}`));
  }

  // Checked up front so a departed player's steps don't 403 into the REST breaker's tally.
  const member = await getGuildMember(character.discordUserId).catch(() => null);
  if (!member) return { member: false };

  if (reborn) return { member: true, reborn: true };

  await setGuildNickname(character.discordUserId, null).catch(log(`nickname for ${character.name}`));
  await openDeadchatTo(prisma, character.discordUserId).catch(log(`deadchat seat for ${character.name}`));
  return { member: true };
}

module.exports = { applyDeathTeardown, stillAlive };
