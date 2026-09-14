// The channel doctor's "cheap: structure" sweep — zone/location channel
// existence, connection-link tag slugs, the Character.zoneId denormalization,
// the bot's role position, and the ghost role's appearance. Moved verbatim
// out of runChannelDoctor (W2d).
const { getChannel } = require("../../discordRest");
const { GHOST_ROLE_ID } = require("../../roleIds");
const { ensureGhostRoleAppearance } = require("../../ghostAccess");

async function runStructureSweep({ report, prisma, zones, locations, locationsById, rolesById, members, alive }) {
  for (const zone of zones) {
    if (zone.kind !== "CAVE_GROUP" && zone.discordRoleId && !rolesById.has(zone.discordRoleId)) {
      await report("zone-structure", zone.name, "recorded zone role no longer exists (run db:sync-zones)");
    }
    if (zone.kind !== "CAVE_GROUP" && !zone.discordRoleId) {
      await report("zone-structure", zone.name, "zone has no role recorded (run db:sync-zones)");
    }
    for (const [label, id] of [
      ["category", zone.discordCategoryId],
      ["summary", zone.discordSummaryChannelId],
    ]) {
      if (!id) continue;
      const live = await getChannel(id, { allow404: true }).catch(() => undefined);
      if (live === null) {
        await report("zone-structure", `${zone.name}/${label}`, "recorded channel no longer exists (run db:sync-zones)");
      }
    }
    if (zone.kind !== "CAVE_GROUP" && zone.locations.length === 0) {
      await report("zone-structure", zone.name, "zone has no locations — nobody can stand in it (check docs/zones.yaml)");
    }
  }
  // A Location wears no role, so its structure is just its channel. The live
  // channel object is kept, because its permission_overwrites are what the
  // occupancy check below diffs — reading it twice would double the doctor's
  // REST cost for nothing.
  const liveLocationChannels = new Map();
  for (const location of locations) {
    const label = `${location.zoneName}/${location.name}`;
    if (!location.discordChannelId) {
      await report("location-structure", label, "location has no channel recorded (run db:sync-zones)");
      continue;
    }
    const live = await getChannel(location.discordChannelId, { allow404: true }).catch(() => undefined);
    if (live === null) {
      await report("location-structure", label, "recorded channel no longer exists (run db:sync-zones)");
    } else if (live) {
      liveLocationChannels.set(location.id, live);
    }
  }

  // The locked/hidden tag a LocationLink names, checked against the live
  // catalog.
  //
  // It CANNOT be a foreign key and cannot be validated at zone-sync time,
  // because tags sync AFTER zones (SYNC.md's working order) — the same trade
  // the room `access:` list makes. So this is where a typo surfaces, and it
  // matters more here than for a room: a locked way naming a tag that does
  // not exist is a way nobody can ever pass, and a HIDDEN one is that plus
  // invisible, so nobody would even report it missing.
  //
  // Report-only. The fix is an edit to docs/zones.yaml, which is the master;
  // there is nothing sensible for --apply to guess.
  const links = await prisma.locationLink.findMany({ where: { requiredTagSlug: { not: null } }, include: { a: true, b: true } });
  if (links.length > 0) {
    const tagSlugs = await prisma.tag
      .findMany({ select: { slug: true } })
      .then((rows) => new Set(rows.map((r) => r.slug)));
    for (const link of links) {
      if (tagSlugs.has(link.requiredTagSlug)) continue;
      const label = `${link.a.name} <-> ${link.b.name}`;
      const kind = link.hidden ? "hidden" : "locked";
      await report("connection-slug", label, `names ${kind} tag "${link.requiredTagSlug}" — no such tag (check docs/zones.yaml)`);
    }
  }

  // Character.zoneId is denormalized from location.zoneId; a mismatch means
  // some writer forgot the contract. Repaired from the location, which is
  // the authority.
  for (const c of alive) {
    if (!c.locationId) {
      await report("character-place", c.name, "living character stands in no location");
      continue;
    }
    const location = locationsById.get(c.locationId);
    if (!location) {
      await report("character-place", c.name, "living character stands in a location that no longer exists");
    } else if (c.zoneId !== location.zoneId) {
      await report("character-place", c.name, "zoneId disagrees with the location's zone", () =>
        prisma.character.update({ where: { id: c.id }, data: { zoneId: location.zoneId } }),
      );
    }
  }

  // The bot's own highest role must sit above every zone role, or the role
  // swaps 403. Report-only — moving roles is a human decision.
  const me = members.get(process.env.DISCORD_CLIENT_ID) ?? null;
  if (me) {
    const botTop = Math.max(...me.roles.map((id) => rolesById.get(id)?.position ?? 0), 0);
    for (const zone of zones) {
      const role = zone.discordRoleId ? rolesById.get(zone.discordRoleId) : null;
      if (role && role.position >= botTop) {
        await report("zone-structure", zone.name, "zone role sits above the bot's highest role — swaps will 403");
      }
    }
  }


  // Ghost appearance: color 0, so ghosts aren't visually outed.
  //
  // The absent case is reported rather than skipped. The id is a constant now
  // (db/lib/roleIds.js), so "not in the guild" means the role was deleted or
  // the constant is stale — and a stale one is worse than a missing env var
  // ever was: every grant below would 404 against a role that isn't there, on
  // every bot start and every turn advance, and the REST breaker only counts
  // 401/403/429 so nothing would damp it.
  const ghost = rolesById.get(GHOST_ROLE_ID) ?? null;
  if (!ghost) {
    await report("ghost-role", GHOST_ROLE_ID, "no such role in the guild — GHOST_ROLE_ID is stale");
  } else if (ghost.color !== 0 || ghost.hoist) {
    await report("ghost-appearance", ghost.name, "ghost role is colored/hoisted", () =>
      ensureGhostRoleAppearance(),
    );
  }

  return { liveLocationChannels };
}

module.exports = { runStructureSweep };
