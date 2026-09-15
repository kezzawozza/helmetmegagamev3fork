// syncZones — The sync: docs/zones.yaml -> DB + Discord, used by
// `npm run db:sync-zones` and wipeGameData's "Restart Game" flow. Split out
// of db/lib/syncZones.js — see that file for the pass overview.
const fs = require("node:fs");
const yaml = require("js-yaml");
const {
  createChannel,
  deleteChannel,
  getGuildRoles,
  createGuildRole,
  deleteGuildRole,
  patchChannel,
  deleteThread,
  editMessage,
  chunkMessage,
  fetchActiveThreads,
} = require("../discordRest");
const { docsPath } = require("../repoPaths");
const {
  zoneChannelSpec,
  locationChannelSpec,
  zoneRoleName,
  zoneGmRoleName,
  gmRoleIdFor,
} = require("../zoneChannelSpec");
const { syncTurnsChannelAccess } = require("../turnsChannelAccess");
const { spectatorsVisibleNow } = require("../spectatorAccess");
const { WATCHTOWER_ROOM_SLUGS } = require("../roomStarterRow");
const { loadLiveStates } = require("../roomLive");
const { orderEndpoints } = require("../locationGraph");
const { canBuildHere, PRESENT_STATUSES } = require("../structures");
const { parseZonesYaml, managedOverwriteIds, reconcileChannelOverwrites } = require("./parse");
const { buildRoomBody } = require("./bodies");
const { syncRoomThread, roomComponents, syncLocationAnchor } = require("./roomThreads");
const { sortZoneCategories, sortZoneChannels } = require("./ordering");
const { hashBody, CHANNEL_TYPE_CATEGORY } = require("./shared");

// docsPath() is null only when docs/ cannot be found at all — fatal for a
// YAML master, since it would otherwise read as "everything was deleted".
function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

// --- The sync ----------------------------------------------------------

async function ensureRole(name, liveRoles) {
  const role = await createGuildRole({
    name,
    permissions: "0",
    color: 0,
    hoist: false,
    mentionable: false,
  });
  liveRoles.add(role.id);
  return role;
}

// Reconciles one Location's LocationYield rows against what the YAML authored.
//
// `base` is always written. `current` is NOT — it is live drifted state
// (db/lib/laborYield.js) and a routine re-sync must not shove every location
// in the game back to its authored value mid-game. The exception is a base
// that actually CHANGED: that is Bascinet retuning the map, and it should take
// effect on the next turn rather than creeping in over a week of drift, so the
// row is reset and any running event cleared.
async function syncLocationYields(prisma, locationId, yields, report) {
  const wanted = yields ?? {};
  const existing = await prisma.locationYield.findMany({ where: { locationId } });
  const byKind = new Map(existing.map((row) => [row.kind, row]));

  for (const [kind, base] of Object.entries(wanted)) {
    const row = byKind.get(kind);
    if (!row) {
      await prisma.locationYield.create({ data: { locationId, kind, base, current: base } });
      report.yieldsCreated += 1;
    } else if (row.base !== base) {
      await prisma.locationYield.update({
        where: { id: row.id },
        data: { base, current: base, eventTarget: null, eventUntilTurn: null },
      });
      report.yieldsRebased += 1;
    }
  }

  for (const row of existing) {
    if (wanted[row.kind] != null) continue;
    await prisma.locationYield.delete({ where: { id: row.id } });
    report.yieldsDeleted += 1;
  }
}

async function syncZonesFromYaml(prisma) {
  // Whether the spectator seat may see anything right now (the phase decides
  // — db/lib/spectatorAccess.js). Read once; every spec below carries it.
  const spectators = await spectatorsVisibleNow(prisma);
  const yamlPath = requireDocsPath("zones.yaml");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  const { zoneEntries, locationEntries, roomEntries, connections, warnings } = parseZonesYaml(doc);
  for (const warning of warnings) console.warn(`zones.yaml: ${warning}`);

  const report = {
    warnings,
    zonesCreated: 0,
    zonesUpdated: 0,
    locationsCreated: 0,
    locationsUpdated: 0,
    locationsMoved: [],
    structuresSeeded: 0,
    yieldsCreated: 0,
    yieldsRebased: 0,
    yieldsDeleted: 0,
    roomsMoved: [],
    rolesCreated: [],
    provisioned: [],
    reconciled: 0,
    permissionRepairs: [],
    rooms: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
    anchors: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
    channelsOrdered: 0,
    channelsReparented: [],
    pruned: [],
    locationsPruned: [],
    roomsPruned: [],
    turnsAccess: null,
  };

  // Pass 1a: upsert zones by slug, parents before children.
  const ordered = [...zoneEntries].sort(
    (a, b) => (a.parentSlug ? 1 : 0) - (b.parentSlug ? 1 : 0),
  );
  const zonesBySlug = new Map();
  for (const entry of ordered) {
    const parent = entry.parentSlug ? zonesBySlug.get(entry.parentSlug) : null;
    if (entry.parentSlug && !parent) {
      throw new Error(`zone "${entry.slug}" names unknown parent "${entry.parentSlug}"`);
    }
    const data = {
      name: entry.name,
      kind: entry.kind,
      sortOrder: entry.sortOrder,
      description: entry.description,
      parentZoneId: parent?.id ?? null,
      mapPolygon: entry.mapPolygon ?? undefined,
      mapLabelX: entry.mapLabelX,
      mapLabelY: entry.mapLabelY,
    };

    let zone = await prisma.zone.findUnique({ where: { slug: entry.slug } });
    if (!zone) {
      zone = await prisma.zone.create({ data: { ...data, slug: entry.slug } });
      report.zonesCreated += 1;
    } else {
      zone = await prisma.zone.update({ where: { id: zone.id }, data: { ...data, slug: entry.slug } });
      report.zonesUpdated += 1;
    }
    zonesBySlug.set(entry.slug, zone);
  }
  const zoneById = new Map([...zonesBySlug.values()].map((z) => [z.id, z]));

  // Pass 1b: seatZoneId — parentZoneId ?? id, now that every id exists.
  for (const zone of zonesBySlug.values()) {
    const seatZoneId = zone.parentZoneId ?? zone.id;
    if (zone.seatZoneId !== seatZoneId) {
      await prisma.zone.update({ where: { id: zone.id }, data: { seatZoneId } });
      zone.seatZoneId = seatZoneId;
    }
  }

  // Pass 1c: locations, matched by slug. A location whose zone changed
  // keeps its channel and role — a text channel CAN be reparented, which the
  // ordering pass does once the category is known.
  const locationsBySlug = new Map();
  for (const entry of locationEntries) {
    const zone = zonesBySlug.get(entry.zoneSlug);
    const data = {
      name: entry.name,
      description: entry.description,
      indoors: entry.indoors,
      attributes: entry.attributes,
      sortOrder: entry.sortOrder,
      zoneId: zone.id,
    };
    let location = await prisma.location.findUnique({ where: { slug: entry.slug } });
    if (!location) {
      location = await prisma.location.create({ data: { ...data, slug: entry.slug } });
      report.locationsCreated += 1;
    } else {
      if (location.zoneId !== zone.id) report.locationsMoved.push(entry.slug);
      location = await prisma.location.update({ where: { id: location.id }, data });
      report.locationsUpdated += 1;
    }
    locationsBySlug.set(entry.slug, location);
    await syncLocationYields(prisma, location.id, entry.yields, report);
    if (entry.structures.length > 0) {
      await seedLocationStructures(prisma, location, zone, entry.structures, report);
    }
  }

  // A Location's seeded structures: the same FLOOR posture as the room stash
  // below. One COMPLETE row per listed type, created only while nothing of
  // that type in PRESENT_STATUSES stands there — so a re-sync never doubles
  // the Square's cross, and a cross the GMs razed (RUINED) or a site somebody
  // walked away from is re-raised, which is what "always standing there"
  // means. Nobody paid and nobody built it, so payer and builder stay null.
  // canBuildHere is a rule for PLAYERS raising things; the YAML is the world,
  // so an indoors cross is a warning to read, not a refusal.
  async function seedLocationStructures(prisma, location, zone, slugs, report) {
    for (const slug of slugs) {
      const tag = await prisma.tag.findUnique({
        where: { slug },
        select: { name: true, placement: true },
      });
      if (!tag) {
        console.warn(`zones.yaml: location "${location.slug}" structures names unknown tag "${slug}" — run db:sync-tags first, then db:sync-zones again.`);
        continue;
      }
      if (!tag.placement) {
        console.warn(`zones.yaml: location "${location.slug}" structures names "${slug}", which has no placement: block — skipped.`);
        continue;
      }
      const ground = canBuildHere({ ...location, zone: { kind: zone.kind } }, tag.placement);
      if (!ground.ok) {
        console.warn(`zones.yaml: "${slug}" seeded at "${location.slug}", where players could not build one (${ground.reason}) — authored on purpose?`);
      }
      const standing = await prisma.structure.count({
        where: { locationId: location.id, typeSlug: slug, status: { in: PRESENT_STATUSES } },
      });
      if (standing > 0) continue;
      await prisma.structure.create({
        data: {
          locationId: location.id,
          typeSlug: slug,
          typeName: tag.name,
          status: "COMPLETE",
          turnsNeeded: 1,
          turnsDone: 1,
          resourcesCost: 0,
        },
      });
      report.structuresSeeded += 1;
    }
  }

  // A Room's seeded stash: the kit that is simply THERE, like the Sanctuary's
  // surgical instruments or the Armory's rack. A SEED, never a reset and never
  // a top-up — an item the room already carries is left exactly as the players
  // left it, and `resources` is written only while the room still holds none.
  // So a re-sync can neither undo somebody carrying the anvil off nor quietly
  // duplicate it. Tags sync AFTER zones, so an unknown slug is skipped with a
  // warning rather than throwing.
  //
  // The items half used to raise an existing stack back to the authored
  // quantity, which made every re-sync a faucet: empty the Lost Convoy's 46
  // obols and the next `db:sync-zones` put them back. `resources` never worked
  // that way, and the header of docs/zones.yaml promised the items did not
  // either.
  //
  // Closing that only closed HALF of it, and the other half cost the live
  // game 139 duplicated items on 2026-09-10 — four wax stamps, a Graywall
  // Key, three Cerberus Keys, a horse. The test was "does a RoomTag row
  // exist", and taking the LAST unit deletes the row
  // (tagWrites.js#dropRoomTag), so a room players had stripped bare was
  // indistinguishable from one that had never been seeded, and every re-sync
  // restocked it. The guard only ever worked while at least one unit
  // remained — i.e. in exactly the cases nobody would notice.
  //
  // So the seed is now recorded on the ROOM (`Room.seededStashSlugs`) rather
  // than inferred from what happens to be lying in it. A slug is written once,
  // ever. A slug newly authored into the YAML still seeds, because it is not
  // in that list yet; an item somebody carried off never returns, because it
  // is. See docs/systemdocs/SYNC.md §2.
  async function seedRoomStash(prisma, roomId, stash, seededSlugs = []) {
    if (stash.resources > 0) {
      // Conditional on 0, so this is a seed and not a top-up: a room somebody
      // has already spent out of stays spent.
      await prisma.room.updateMany({
        where: { id: roomId, resources: 0 },
        data: { resources: stash.resources },
      });
    }
    const seeded = new Set(seededSlugs);
    const newlySeeded = [];
    for (const [slug, quantity] of stash.items) {
      // Seeded before: leave it, whatever the room holds now. This is the
      // whole fix — the question is "has this room ever been given one",
      // never "is one lying here".
      if (seeded.has(slug)) continue;
      const tag = await prisma.tag.findUnique({ where: { slug }, select: { id: true } });
      if (!tag) {
        // Unknown tag: zones sync BEFORE tags, so on a database that has never
        // seen db:sync-tags this is expected (LAUNCH.md §5 runs the zone sync
        // twice for it). Skip WITHOUT recording the slug, so the second run
        // still seeds it.
        console.warn(`zones.yaml: room stash names unknown tag "${slug}" — run db:sync-tags first.`);
        continue;
      }
      const existing = await prisma.roomTag.findUnique({
        where: { roomId_tagId: { roomId, tagId: tag.id } },
        select: { id: true },
      });
      if (!existing) {
        await prisma.roomTag.create({ data: { roomId, tagId: tag.id, quantity } });
      }
      // Recorded even when a row already existed: the room demonstrably has
      // this item, so the seed is spent either way.
      newlySeeded.push(slug);
    }
    if (newlySeeded.length) {
      await prisma.room.update({
        where: { id: roomId },
        data: { seededStashSlugs: { push: newlySeeded } },
      });
    }
  }

  // Pass 1c-bis: rooms, matched by slug. A thread can't change parents, so a
  // room whose location changed is deleted and recreated by the room pass.
  const roomsBySlug = new Map();
  for (const entry of roomEntries) {
    const location = locationsBySlug.get(entry.locationSlug);
    const data = {
      name: entry.name,
      description: entry.description,
      sortOrder: entry.sortOrder,
      kind: entry.kind,
      accessTagSlugs: entry.accessTagSlugs,
      destroysContents: entry.destroysContents,
      soundproof: entry.soundproof,
      live: entry.live,
      locationId: location.id,
    };
    let room = await prisma.room.findUnique({ where: { slug: entry.slug } });
    if (!room) {
      room = await prisma.room.create({ data: { ...data, slug: entry.slug } });
    } else if ((room.locationId !== location.id || room.kind !== entry.kind) && room.discordThreadId) {
      // A kind change is a thread-type change, which Discord can't do either.
      await deleteThread(room.discordThreadId);
      report.roomsMoved.push(entry.slug);
      room = await prisma.room.update({
        where: { id: room.id },
        data: { ...data, discordThreadId: null, starterMessageId: null, postHash: null },
      });
    } else {
      room = await prisma.room.update({ where: { id: room.id }, data });
    }
    roomsBySlug.set(entry.slug, room);
    if (entry.stash.resources > 0 || entry.stash.items.length > 0) {
      // `room` is the row as it stands after the upsert above, so its
      // seededStashSlugs is current. A room that merely MOVED location keeps
      // its record (the branch above updates, never recreates); a room whose
      // slug left the YAML and came back is a new row with an empty list, and
      // seeds fresh — which is right, since a changed id is not a rename.
      await seedRoomStash(prisma, room.id, entry.stash, room.seededStashSlugs ?? []);
    }
  }

  // Pass 1d: the travel graph. ONE LocationLink row per undirected edge,
  // endpoints in ascending slug order (db/lib/locationGraph.js#orderEndpoints
  // is the shared rule), so an attribute cannot disagree between the two
  // directions.
  //
  // The YAML is the master, so an edge it no longer lists is deleted. Two
  // things are NOT taken from the YAML on an existing row, because both are
  // play state rather than authoring: `isOpen`, so a modular gate somebody
  // shut stays shut across a re-sync instead of every sync silently reopening
  // the Gatehouse; and `openUntil`, so a keyed way somebody is holding open
  // keeps standing open for its 24 hours. `modular.open` is therefore the
  // value a link is BORN with, not one the sync re-asserts.
  const wantedLinkKeys = new Set();
  for (const entry of connections) {
    const locA = locationsBySlug.get(entry.a);
    const locB = locationsBySlug.get(entry.b);
    const { aId, bId } = orderEndpoints(entry.a, locA.id, entry.b, locB.id);
    wantedLinkKeys.add(`${aId}:${bId}`);

    const data = {
      announce: entry.announce,
      requiredTagSlug: entry.requiredTagSlug,
      hidden: entry.hidden,
      modular: entry.modular,
      // The born state, re-asserted as authoring (isOpen itself never is):
      // it is what the Restart wipe resets isOpen to.
      authoredOpen: entry.isOpen,
      // Orphan columns. A gate used to name the Roles and tags that could
      // work it; now reaching the watchtower is the whole permission model,
      // so nothing reads these and the sync empties them rather than leaving
      // a list behind that lies about who may pull the winch.
      openerRoleSlugs: [],
      openerTagSlugs: [],
      keyed: entry.keyed,
      onFoot: entry.onFoot,
    };
    await prisma.locationLink.upsert({
      where: { aId_bId: { aId, bId } },
      update: data,
      create: { aId, bId, ...data, isOpen: entry.isOpen },
    });
  }

  const staleLinks = await prisma.locationLink.findMany({ select: { id: true, aId: true, bId: true } });
  for (const link of staleLinks) {
    if (wantedLinkKeys.has(`${link.aId}:${link.bId}`)) continue;
    await prisma.locationLink.delete({ where: { id: link.id } });
    report.linksPruned = (report.linksPruned ?? 0) + 1;
  }
  report.links = wantedLinkKeys.size;

  // Pass 2a: roles — one per presence zone, and nothing else. Created when
  // null OR the recorded role was deleted by hand (doctor reports it, this
  // repairs it).
  //
  // Locations deliberately get NO role. 56 of them would have cost 56 of the
  // guild's 250 roles on top of one personal role per living character; a
  // Location channel is opened by a per-member overwrite instead, written by
  // db/lib/locationMove.js and reconciled by the doctor's occupancy check.
  const liveRoles = new Set((await getGuildRoles()).map((r) => r.id));
  for (const zone of zonesBySlug.values()) {
    if (zone.kind === "CAVE_GROUP") continue;
    if (zone.discordRoleId && liveRoles.has(zone.discordRoleId)) continue;
    const role = await ensureRole(zoneRoleName(zone), liveRoles);
    await prisma.zone.update({ where: { id: zone.id }, data: { discordRoleId: role.id } });
    zone.discordRoleId = role.id;
    report.rolesCreated.push(zoneRoleName(zone));
  }

  // Pass 2a-bis: the GM seat, one per SEAT zone. The CAVE_GROUP gets one
  // (it owns the category its levels' Location channels parent to, and gets
  // no access role because nobody stands in a group); the two cave LEVELS do
  // not, and instead hand their Locations the group's seat.
  //
  // That is the mirror of Zone.seatZoneId (db/lib/seatZone.js): a faction is
  // keyed to the Underground seat and never to a level, so a GM who picked
  // "Caves" would have got a desk that could never match a row. One seat,
  // both faces — pick Underground and you get the cave channels AND the cave
  // rows.
  for (const zone of zonesBySlug.values()) {
    if (zone.kind === "CAVE_LEVEL") continue;
    if (zone.gmRoleId && liveRoles.has(zone.gmRoleId)) continue;
    const role = await ensureRole(zoneGmRoleName(zone), liveRoles);
    await prisma.zone.update({ where: { id: zone.id }, data: { gmRoleId: role.id } });
    zone.gmRoleId = role.id;
    report.rolesCreated.push(zoneGmRoleName(zone));
  }

  // Pass 2b: categories + channels, create-only. Groups before levels.
  const provisionOrder = [...zonesBySlug.values()].sort((a, b) => {
    const rank = (z) => (z.kind === "CAVE_GROUP" ? 0 : z.kind === "SURFACE" ? 1 : 2);
    return rank(a) - rank(b) || a.sortOrder - b.sortOrder;
  });
  const categoryIdFor = (zone) =>
    zone.discordCategoryId ?? (zone.parentZoneId ? zoneById.get(zone.parentZoneId)?.discordCategoryId : null) ?? null;

  for (const zone of provisionOrder) {
    const spec = zoneChannelSpec(zone, { spectators });
    const updates = {};

    // A zone whose KIND changed keeps Discord ids its new kind has no use
    // for. The Bascinet 2 map turned the old Caves group row into a Caves
    // cave-level (same slug, so the sync upserted rather than replaced), and
    // it carried the group's category id with it — which would have pulled
    // every cave channel back out of Underground on the next run, because
    // categoryIdFor prefers a zone's own category over its parent's. Forget
    // the ids; deleting the channel they point at is
    // db:prune-stale-channels' job, not this pass's.
    const orphaned = {};
    if (!spec.category && zone.discordCategoryId) orphaned.discordCategoryId = null;
    if (!spec.summary && zone.discordSummaryChannelId) orphaned.discordSummaryChannelId = null;
    if (Object.keys(orphaned).length > 0) {
      await prisma.zone.update({ where: { id: zone.id }, data: orphaned });
      Object.assign(zone, orphaned);
      report.warnings.push(
        `zone "${zone.name}" is ${zone.kind} and no longer owns ${Object.keys(orphaned).join(", ")} — ` +
          `forgotten here, run db:prune-stale-channels to delete the channel itself`,
      );
    }

    if (spec.category && !zone.discordCategoryId) {
      const category = await createChannel(spec.category);
      updates.discordCategoryId = category.id;
      zone.discordCategoryId = category.id;
    }
    if (spec.summary && !zone.discordSummaryChannelId) {
      updates.discordSummaryChannelId = (
        await createChannel({ ...spec.summary, parent_id: categoryIdFor(zone) })
      ).id;
      zone.discordSummaryChannelId = updates.discordSummaryChannelId;
    }
    if (Object.keys(updates).length > 0) {
      zone.justProvisioned = true;
      await prisma.zone.update({ where: { id: zone.id }, data: updates });
      report.provisioned.push(zone.name);
    }
  }
  for (const location of [...locationsBySlug.values()].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (location.discordChannelId) continue;
    const zone = zoneById.get(location.zoneId);
    const channel = await createChannel({
      ...locationChannelSpec(location, gmRoleIdFor(zone, zoneById), { spectators }),
      parent_id: categoryIdFor(zone),
    });
    await prisma.location.update({ where: { id: location.id }, data: { discordChannelId: channel.id } });
    location.discordChannelId = channel.id;
    location.justProvisioned = true;
    report.provisioned.push(`${zone.name} / ${location.name}`);
  }

  // Pass 3: reconcile everything already provisioned. Freshly provisioned
  // targets skip the overwrite reconcile but still get threads + anchors.
  const managed = managedOverwriteIds([
    ...[...zonesBySlug.values()].map((z) => z.discordRoleId),
    // The per-zone GM seats. Miss these and the reconciler deletes the
    // overwrite it wrote one pass earlier, every single run.
    ...[...zonesBySlug.values()].map((z) => z.gmRoleId),
  ]);

  for (const zone of zonesBySlug.values()) {
    if (zone.justProvisioned) continue;
    const spec = zoneChannelSpec(zone, { spectators });
    const targets = [
      ["category", zone.discordCategoryId, spec.category],
      ["summary", zone.discordSummaryChannelId, spec.summary],
    ];
    let reconciledAny = false;
    for (const [label, channelId, want] of targets) {
      if (!channelId || !want) continue;
      reconciledAny = true;
      if (want.type !== CHANNEL_TYPE_CATEGORY) {
        await patchChannel(channelId, {
          topic: want.topic ?? "",
          ...(want.rate_limit_per_user !== undefined
            ? { rate_limit_per_user: want.rate_limit_per_user }
            : {}),
        });
      }
      const removed = await reconcileChannelOverwrites(channelId, want, managed);
      for (const id of removed) {
        report.permissionRepairs.push(`${zone.name} (${label}): removed stray overwrite for ${id}`);
      }
    }
    if (reconciledAny) report.reconciled += 1;
  }
  for (const location of locationsBySlug.values()) {
    if (location.justProvisioned || !location.discordChannelId) continue;
    const want = locationChannelSpec(location, gmRoleIdFor(zoneById.get(location.zoneId), zoneById), { spectators });
    await patchChannel(location.discordChannelId, { topic: want.topic ?? "" });
    const removed = await reconcileChannelOverwrites(location.discordChannelId, want, managed);
    for (const id of removed) {
      report.permissionRepairs.push(`${location.name}: removed stray overwrite for ${id}`);
    }
    report.reconciled += 1;
  }

  await sortZoneCategories(prisma);
  const channelOrder = await sortZoneChannels(prisma);
  report.channelsOrdered = channelOrder.ordered;
  report.channelsReparented = channelOrder.reparented;

  // Room threads, then anchors — the anchor body embeds the thread ids.
  // The active-thread snapshot is fetched ONCE; it only serves adoption.
  const snapshot = await fetchActiveThreads().catch((err) => {
    console.error("sync-zones: active-thread snapshot failed, falling back to per-channel fetches:", err.message);
    return null;
  });
  const roomsByLocationId = new Map();
  for (const room of roomsBySlug.values()) {
    if (!roomsByLocationId.has(room.locationId)) roomsByLocationId.set(room.locationId, []);
    roomsByLocationId.get(room.locationId).push(room);
  }
  const locationById = new Map([...locationsBySlug.values()].map((l) => [l.id, l]));
  // One load per KIND of live line, not one per room.
  const liveStates = await loadLiveStates(
    prisma,
    [...roomsBySlug.values()].map((room) => room.live).filter(Boolean),
  );
  for (const room of roomsBySlug.values()) {
    report.rooms[
      await syncRoomThread(prisma, room, locationById.get(room.locationId), snapshot, liveStates.get(room.live))
    ] += 1;
  }
  for (const location of locationsBySlug.values()) {
    report.anchors[await syncLocationAnchor(prisma, location, roomsByLocationId.get(location.id) ?? [])] += 1;
  }

  // Pass 4: prune. Rooms first (threads under location channels), then
  // locations (channel and row — characters standing there are set null and
  // the doctor reports them; deleting the channel takes every occupant
  // overwrite with it), then zones.
  // `questId: null` is the one exemption, and it is load-bearing. A quest room
  // is minted at runtime from /gm/dev, so its slug is in no YAML and every
  // other row here would read it as stale — the next sync would delete the
  // thread and the row out from under a live quest. Quests have their own
  // clock instead: db/lib/quests.js closes them on expiry or when a GM says so.
  const staleRooms = await prisma.room.findMany({
    where: { slug: { notIn: [...roomsBySlug.keys()] }, questId: null },
  });
  for (const room of staleRooms) {
    if (room.discordThreadId) await deleteThread(room.discordThreadId);
    await prisma.room.delete({ where: { id: room.id } });
    report.roomsPruned.push(room.name);
  }

  const staleLocations = await prisma.location.findMany({
    where: { slug: { notIn: [...locationsBySlug.keys()] } },
  });
  for (const location of staleLocations) {
    if (location.discordChannelId) await deleteChannel(location.discordChannelId);
    await prisma.location.delete({ where: { id: location.id } });
    report.locationsPruned.push(location.name);
  }

  const staleZones = await prisma.zone.findMany({ where: { slug: { notIn: [...zonesBySlug.keys()] } } });
  for (const zone of staleZones) {
    // Location.zoneId is onDelete: Cascade, so deleting the zone row below
    // takes its Locations (and their Rooms) with it in one statement —
    // silently, and WITHOUT passing through the location prune above, which
    // only sees slugs the YAML dropped. A zone the YAML dropped while its
    // Locations kept their slugs therefore left a full set of live Discord
    // channels behind that no row pointed at any more, and the next sync,
    // finding no discordChannelId, made a second set beside them. That is how
    // the Underground ended up with two of every cave channel on 2026-09-08.
    // Take the channels and threads down here, before the cascade eats the
    // rows that name them.
    const doomedLocations = await prisma.location.findMany({
      where: { zoneId: zone.id },
      select: { discordChannelId: true, rooms: { select: { discordThreadId: true } } },
    });
    for (const location of doomedLocations) {
      // The threads go first: deleting a channel takes its threads anyway,
      // but a room whose thread lives elsewhere is not the channel's to lose.
      for (const room of location.rooms) {
        if (room.discordThreadId) await deleteThread(room.discordThreadId);
      }
      if (location.discordChannelId) await deleteChannel(location.discordChannelId);
    }
    if (doomedLocations.length > 0) {
      report.warnings.push(
        `pruning zone "${zone.name}" also took ${doomedLocations.length} Location row(s) with it (FK cascade)`,
      );
    }

    for (const id of [zone.discordSummaryChannelId, zone.discordCategoryId].filter(Boolean)) {
      await deleteChannel(id);
    }
    if (zone.discordRoleId) await deleteGuildRole(zone.discordRoleId);
    if (zone.gmRoleId) await deleteGuildRole(zone.gmRoleId);

    // CavingRoll.zoneId is the one FK into Zone that is required, so it
    // RESTRICTs rather than nulling and would abort the whole prune. Its own
    // comment calls the column a snapshot, and ARCHITECTURE.md's rule is that
    // a log stores snapshot COLUMNS rather than foreign keys — this one never
    // got that treatment. Until it does, a roll in a zone that no longer
    // exists goes with the zone, the same way a pruned Room takes its stash.
    // Counted, never silent: it is a log, and deleting one should show up in
    // the report.
    const rolls = await prisma.cavingRoll.deleteMany({ where: { zoneId: zone.id } });
    if (rolls.count > 0) {
      report.warnings.push(
        `pruning zone "${zone.name}" deleted ${rolls.count} CavingRoll row(s) that happened there`,
      );
    }

    await prisma.zone.delete({ where: { id: zone.id } });
    report.pruned.push(zone.name);
  }

  // Pass 5: #turns — its view grants are keyed on zone roles, and Pass 2a
  // can recreate a role with a new id, so this repairs any stale grant.
  report.turnsAccess = await syncTurnsChannelAccess(prisma).catch((err) => {
    report.warnings.push(`#turns access sync failed: ${err.message}`);
    return null;
  });

  return report;
}

// Reposts one location's anchor from current state. The gate button handler
// calls this after flipping a link, on BOTH endpoints — the gate has a button
// on each side and shutting it from one must not leave the other reading
// "Open".
async function refreshLocationAnchor(prisma, locationId) {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) return "skipped";
  const rooms = await prisma.room.findMany({
    where: { locationId },
    orderBy: { sortOrder: "asc" },
  });
  return syncLocationAnchor(prisma, location, rooms);
}

// Re-renders the room starters matching `where` and edits the ones whose post
// actually moved. Two callers, below: a live key changing (the Depot's shuttle
// buttons, the turn pass, the Dev Panel) and a gate flipping. Both want the
// same thing — the starter as syncRoomThread would draw it right now.
//
// One loop rather than two on purpose. The hash MUST be composed exactly as
// syncRoomThread composes it, or a starter reposts on every call forever, and
// that recipe is a trap worth having in a single place. roomComponents is what
// guarantees it.
//
// Edits in place rather than going through syncRoomThread: a room whose thread
// is missing is a job for the sync or the channel doctor, not for a shuttle
// taking off or a gate closing.
async function refreshRoomStarters(prisma, where, label) {
  const rooms = await prisma.room.findMany({ where });
  if (!rooms.length) return 0;

  const liveKeys = [...new Set(rooms.map((r) => r.live).filter(Boolean))];
  const states = liveKeys.length ? await loadLiveStates(prisma, liveKeys) : new Map();

  let edited = 0;
  for (const room of rooms) {
    if (!room.discordThreadId || !room.starterMessageId) continue;
    const body = buildRoomBody(room, room.live ? states.get(room.live) : null);
    const components = await roomComponents(prisma, room, room.locationId);
    const hash = hashBody(body + JSON.stringify(components));
    if (room.postHash === hash) continue;
    try {
      await editMessage(room.discordThreadId, room.starterMessageId, chunkMessage(body)[0], components);
    } catch (err) {
      console.error(`${label} room refresh failed (${room.slug}):`, err.message);
      continue;
    }
    await prisma.room.update({ where: { id: room.id }, data: { postHash: hash } });
    edited += 1;
  }
  return edited;
}

// Every room carrying one live key.
async function refreshLiveRooms(prisma, key) {
  return refreshRoomStarters(prisma, { live: key }, "live");
}

// The watchtower that carries this location's gate button — the room-thread
// twin of refreshLocationAnchor, and every caller of that one calls this too.
// The anchor no longer renders a gate at all, so this is the only repost that
// shows a flip anywhere. A watchtower whose thread is gone therefore shows it
// nowhere until the sync or the doctor puts the thread back, which is the
// trade for having exactly one place the button lives.
async function refreshGateRooms(prisma, locationId) {
  return refreshRoomStarters(
    prisma,
    { locationId, slug: { in: [...WATCHTOWER_ROOM_SLUGS] } },
    "gate",
  );
}

module.exports = {
  syncZonesFromYaml,
  refreshLiveRooms,
  refreshLocationAnchor,
  refreshGateRooms,
};
