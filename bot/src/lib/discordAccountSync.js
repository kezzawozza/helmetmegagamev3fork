// Caches every guild member's Discord handle, so a GM can search "peace.lock"
// instead of a snowflake. The rule and the writes live in
// db/lib/discordAccounts.js — this is only the gateway half.
//
// Deliberately NOT folded into nickname.js, which shares the members.fetch():
// that sync returns early when GameConfig.nicknameSyncEnabled is off, and
// handles would then silently stop being captured for a reason that has nothing
// to do with them. Two concerns, two passes, one cheap fetch each.
const { prisma } = require("@lifeweb/db");
const { accountRowsFromMembers, syncDiscordAccounts } = require("@lifeweb/db/lib/discordAccounts");

// One member, from an event that already holds them (guildMemberAdd, and the
// proxy pipeline's author). Cheap enough to call on every sighting: the shared
// helper reads before it writes, so an unchanged handle costs one indexed read.
async function rememberMember(member) {
  const rows = accountRowsFromMembers([member]);
  if (!rows.length) return;
  try {
    await syncDiscordAccounts(prisma, rows);
  } catch (err) {
    // Never fail the caller's real work over a cache write.
    console.error(`Failed to remember Discord handle for ${member?.id}: ${err.message}`);
  }
}

// The bulk catch-up, called from ready.js. `guild.members.fetch()` is a gateway
// fetch, not REST, so it costs nothing against the request budget
// (bot/src/lib/leaveReconcile.js says the same of its own).
async function syncDiscordAccountsForGuild(guild) {
  try {
    await guild.members.fetch();
    const rows = accountRowsFromMembers([...guild.members.cache.values()]);
    const { created, updated, unchanged } = await syncDiscordAccounts(prisma, rows);
    console.log(
      `Discord handles for guild ${guild.name}: ${created} new, ${updated} changed, ${unchanged} unchanged`,
    );
  } catch (err) {
    console.error(`Failed to sync Discord handles for guild ${guild.name}: ${err.message}`);
  }
}

module.exports = { rememberMember, syncDiscordAccountsForGuild };
