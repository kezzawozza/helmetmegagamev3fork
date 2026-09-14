// Deletes Discord categories, channels and Zone/Location roles left behind by
// a PREVIOUS game — objects no row in the database points at any more.
// Nothing else can do this job: db:sync-zones only prunes what it can see in
// the DB, and the channel doctor never deletes a channel at all, so a
// retired layout lingers next to the live one under a same-named category.
// Dry run by default with an --apply flag. Conservative by construction — no
// hardcoded ids: a category is a candidate only when its name matches a live
// Zone's AND no DB row references it, channels are only deleted as children
// of a candidate category, and the run aborts if any candidate turns out to
// be referenced after all.
require("dotenv").config();
const { prisma } = require("../../index");
const { discordRequest, deleteChannel, deleteGuildRole } = require("../../lib/discordRest");

const CHANNEL_TYPE_CATEGORY = 4;

async function main() {
  const apply = process.argv.includes("--apply");
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error("DISCORD_GUILD_ID is not set.");

  const [channels, roles, zones, locations, rooms] = await Promise.all([
    discordRequest(`/guilds/${guildId}/channels`),
    discordRequest(`/guilds/${guildId}/roles`),
    prisma.zone.findMany({
      select: {
        name: true,
        discordCategoryId: true,
        discordSummaryChannelId: true,
        discordRoleId: true,
      },
    }),
    prisma.location.findMany({ select: { discordChannelId: true } }),
    prisma.room.findMany({ select: { discordThreadId: true } }),
  ]);

  const keep = new Set(); // every Discord id the live game still owns; membership is an absolute veto
  for (const z of zones) {
    if (z.discordCategoryId) keep.add(z.discordCategoryId);
    if (z.discordSummaryChannelId) keep.add(z.discordSummaryChannelId);
  }
  for (const l of locations) if (l.discordChannelId) keep.add(l.discordChannelId);
  for (const r of rooms) if (r.discordThreadId) keep.add(r.discordThreadId);

  const zoneNames = new Set(zones.map((z) => z.name));
  const byId = new Map(channels.map((c) => [c.id, c]));

  // --- channels ---------------------------------------------------------
  const staleCategories = channels.filter(
    (c) => c.type === CHANNEL_TYPE_CATEGORY && zoneNames.has(c.name) && !keep.has(c.id),
  );
  const staleCategoryIds = new Set(staleCategories.map((c) => c.id));
  const staleChildren = channels.filter(
    (c) => c.type !== CHANNEL_TYPE_CATEGORY && c.parent_id && staleCategoryIds.has(c.parent_id),
  );

  // --- roles: EVERY "Location: X" role is stale by definition now — Locations
  // stopped wearing roles, so nothing recreates one and this retires leftovers.
  const liveRoleIds = new Set(zones.map((z) => z.discordRoleId).filter(Boolean));
  const staleRoles = roles.filter(
    (r) => /^(Zone|Location): /.test(r.name) && !liveRoleIds.has(r.id),
  );

  // --- safety gates -----------------------------------------------------
  const violations = [];
  for (const c of [...staleCategories, ...staleChildren]) {
    if (keep.has(c.id)) violations.push(`#${c.name} (${c.id}) is referenced by a live DB row`);
  }
  for (const c of staleChildren) {
    const parent = byId.get(c.parent_id);
    if (!parent || !zoneNames.has(parent.name)) {
      violations.push(`#${c.name} (${c.id}) has a parent that is not a zone category`);
    }
  }
  for (const r of staleRoles) {
    if (liveRoleIds.has(r.id)) violations.push(`role ${r.name} (${r.id}) is live`);
  }
  if (violations.length) {
    console.error("Refusing to run — the candidate set is not safe:");
    for (const v of violations) console.error(`  ! ${v}`);
    process.exitCode = 1;
    return;
  }

  // --- report -----------------------------------------------------------
  console.log(
    `Guild has ${channels.length} channel(s) and ${roles.length} role(s); the DB claims ${keep.size} channel id(s).\n`,
  );

  const total = staleCategories.length + staleChildren.length + staleRoles.length;
  if (!total) {
    console.log("No stale categories, channels or zone roles. Nothing to prune.");
    return;
  }

  const verb = apply ? "Deleting" : "Would delete";
  for (const cat of staleCategories) {
    const kids = staleChildren.filter((c) => c.parent_id === cat.id);
    console.log(`${verb} category ${cat.name} (${cat.id}) and its ${kids.length} channel(s):`);
    for (const k of kids) console.log(`    - #${k.name} (${k.id})`);
  }
  if (staleRoles.length) {
    console.log(`\n${verb} ${staleRoles.length} stale zone/location role(s):`);
    for (const r of staleRoles) console.log(`    - ${r.name} (${r.id})`);
  }

  const survivingCategories = channels.filter(
    (c) => c.type === CHANNEL_TYPE_CATEGORY && !staleCategoryIds.has(c.id),
  );
  console.log(
    `\nUntouched: ${survivingCategories.length} categor(y|ies) — ${survivingCategories.map((c) => c.name).join(", ")}`,
  );

  if (!apply) {
    console.log(`\n${total} object(s). Dry run — re-run with \`-- --apply\` to delete.`);
    return;
  }

  let deleted = 0; // sequential, one per-guild rate-limit bucket; children before their category
  for (const c of [...staleChildren, ...staleCategories]) {
    try {
      await deleteChannel(c.id);
      deleted += 1;
    } catch (err) {
      console.error(`  ! failed to delete #${c.name} (${c.id}): ${err.message}`);
    }
  }
  for (const r of staleRoles) {
    try {
      await deleteGuildRole(r.id);
      deleted += 1;
    } catch (err) {
      console.error(`  ! failed to delete role ${r.name} (${r.id}): ${err.message}`);
    }
  }
  console.log(`\nDeleted ${deleted} of ${total}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
