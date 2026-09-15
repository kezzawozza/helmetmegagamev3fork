// Deletes personal character roles in Discord that no living character
// claims — role deletion is best-effort at every call site, and Discord's
// 250-role cap means orphans eventually block new characters. Dry-run by
// default with an --apply flag. Conservative by construction: a role is only
// a candidate when it carries the character-role SIGNATURE below, no
// Character row references it, nobody holds it, it has no permissions, and
// it isn't integration-managed or a standing role.
require("dotenv").config();
const { prisma } = require("../../index");
const { discordRequest } = require("../../lib/discordRest");
const {
  PLAYER_ROLE_ID,
  SPECTATOR_ROLE_ID,
  LEADER_WHITELIST_ROLE_ID,
  PLAYTEST_ROLE_ID,
  gmRoleIds,
} = require("../../lib/roleIds");
const { hashNameToColor } = require("../../lib/roleColor");
const {
  CATATONIC_ROLE_COLOR,
  CATATONIC_ROLE_SUFFIX,
} = require("../../lib/characterRoleAppearance");

function looksLikeCharacterRole(role) {
  return role.mentionable === true && role.color === hashNameToColor(role.name);
}

// A Catatonic repaint ("<name> • Catatonic", flat grey) fails the signature
// above; --include-catatonic accepts that second exact appearance too, for a
// role left behind by a PREVIOUS game — unclaimed AND unmatchable otherwise.
function looksLikeCatatonicRole(role) {
  return (
    role.mentionable === true &&
    role.color === CATATONIC_ROLE_COLOR &&
    role.name.endsWith(CATATONIC_ROLE_SUFFIX)
  );
}

function protectedRoleIds() {
  return new Set(
    [
      PLAYER_ROLE_ID,
      SPECTATOR_ROLE_ID,
      LEADER_WHITELIST_ROLE_ID,
      PLAYTEST_ROLE_ID,
      ...gmRoleIds(),
      process.env.DISCORD_TURN_PING_ROLE_ID,
    ].filter(Boolean),
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const includeCatatonic = process.argv.includes("--include-catatonic");
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error("DISCORD_GUILD_ID is not set.");

  const [roles, characters, zones, members] = await Promise.all([
    discordRequest(`/guilds/${guildId}/roles`),
    prisma.character.findMany({
      where: { discordRoleId: { not: null } },
      select: { discordRoleId: true, name: true, status: true },
    }),
    prisma.zone.findMany({ select: { discordRoleId: true, gmRoleId: true } }), // both zone role families
    discordRequest(`/guilds/${guildId}/members?limit=1000`),
  ]);

  // "Permissionless" can't just mean "0" — Discord copies @everyone's
  // permissions when the field is omitted, so a role matching @everyone
  // counts as permissionless too; anything ELSE is a real access role.
  const everyoneRole = roles.find((r) => r.id === guildId);
  const baselinePermissions = new Set(["0", everyoneRole?.permissions].filter(Boolean));

  const claimed = new Map(characters.map((c) => [c.discordRoleId, c]));
  const protectedIds = protectedRoleIds();
  // Zone-access and per-zone GM roles are standing infrastructure; protecting
  // them by id keeps this safe against a future signature change. A leftover
  // "Location: X" role is db:prune-stale-channels' to retire.
  for (const zone of zones) {
    if (zone.discordRoleId) protectedIds.add(zone.discordRoleId);
    if (zone.gmRoleId) protectedIds.add(zone.gmRoleId);
  }

  // Held by at least one member — never a candidate, whatever else is true.
  const held = new Set();
  for (const m of members) for (const roleId of m.roles ?? []) held.add(roleId);

  const candidates = [];
  const kept = [];

  for (const role of roles) {
    if (role.id === guildId) continue; // @everyone shares the guild's id
    const reasons = [];
    if (protectedIds.has(role.id)) reasons.push("standing role");
    if (claimed.has(role.id)) reasons.push(`claimed by ${claimed.get(role.id).name}`);
    if (held.has(role.id)) reasons.push("held by a member");
    if (role.managed) reasons.push("managed by an integration");
    if (role.permissions && !baselinePermissions.has(role.permissions)) {
      reasons.push("carries permissions");
    }
    const isCharacterRole =
      looksLikeCharacterRole(role) || (includeCatatonic && looksLikeCatatonicRole(role));
    if (!isCharacterRole) reasons.push("not a character role");

    if (reasons.length) kept.push({ role, reasons });
    else candidates.push(role);
  }

  console.log(`Guild has ${roles.length} role(s) of Discord's 250 cap.`);
  if (includeCatatonic) console.log("--include-catatonic: catatonic-styled roles are candidates too.");
  console.log(
    `${characters.length} character role(s) claimed (${characters.filter((c) => c.status === "ALIVE").length} by living characters).\n`,
  );

  if (!candidates.length) {
    console.log("No orphaned roles. Nothing to prune.");
    return;
  }

  console.log(`${apply ? "Deleting" : "Would delete"} ${candidates.length} orphaned role(s):`);
  for (const role of candidates) console.log(`  - ${role.name} (${role.id})`);

  if (!apply) {
    console.log(`\n${kept.length} role(s) kept. Dry run — re-run with \`-- --apply\` to delete.`);
    return;
  }

  let deleted = 0; // sequential: a burst of guild-role DELETEs against one per-guild bucket
  for (const role of candidates) {
    try {
      await discordRequest(`/guilds/${guildId}/roles/${role.id}`, { method: "DELETE", allow404: true });
      deleted += 1;
    } catch (err) {
      console.error(`  ! failed to delete ${role.name} (${role.id}): ${err.message}`);
    }
  }
  console.log(`\nDeleted ${deleted} of ${candidates.length}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
