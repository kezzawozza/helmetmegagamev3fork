// The mirror's structure sweep — checks about ROWS, not Discord objects: a
// zone nobody can stand in, a connection naming a tag that does not exist, a
// character whose denormalized zoneId disagrees with their location, and the
// bot's own role position. Missing Discord structure is the op list's job now
// (db/lib/discordMirror/diff.js), not this sweep's.
async function runStructureSweep({ report, prisma, zones, rolesById, members, alive, locationsById }) {
  for (const zone of zones) {
    if (zone.kind !== "CAVE_GROUP" && zone.locations.length === 0) {
      await report("zone-structure", zone.name, "zone has no locations — nobody can stand in it");
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

}

module.exports = { runStructureSweep };
