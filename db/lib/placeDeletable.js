// What it means to remove a place — a Zone, Location or Room — from
// /gm/dev/zones. Two different acts, never conflated:
//
//   retirePlace       Soft-retire (Zone/Location/Room.retiredAt). The row
//                      stays; it just falls out of every picker, the travel
//                      graph, the map and the mirror's desired state — see
//                      the schema comment on retiredAt. Refused outright if
//                      an ALIVE character is standing there right now: a
//                      retire is meant to be reversible and quiet, not a way
//                      to strand somebody.
//
//   hardDeletePlace    Actually removes the row. Only for a place that has
//                      never been touched by play — anything holding a
//                      reference to it is a "blocker", and hardDeletePlace
//                      refuses to run while any exist. hardDeleteBlockers
//                      returns them as human strings for the UI to show,
//                      never a cascade.
//
// Both are superadmin-only actions in the UI (web/lib/devAccess.js's
// requireDev("super")); this module doesn't itself check who is calling.
// Required as the whole module, not destructured, so a test can stub one of
// these exports on the object (db/test/discordMirrorApply.test.js's pattern)
// without this file ever seeing the network.
const discordRest = require("./discordRest");
const { RESOURCES_SLUG, readRoomResources } = require("./resourceStack");

const KIND_MODEL = { zone: "zone", location: "location", room: "room" };

function modelFor(prisma, kind) {
  const name = KIND_MODEL[kind];
  if (!name) throw new Error(`placeDeletable: unknown kind "${kind}"`);
  return prisma[name];
}

// True if a living character is standing in this place right now. A Zone or
// Location asks Character.zoneId/locationId directly; a Room has no such
// column (standing is always a Location), so a Room can never hold this kind
// of blocker — RoomGuest is a courtesy list, not a place to stand.
async function hasLivingOccupant(prisma, kind, id) {
  if (kind === "zone") return Boolean(await prisma.character.findFirst({ where: { zoneId: id, status: "ALIVE" } }));
  if (kind === "location") return Boolean(await prisma.character.findFirst({ where: { locationId: id, status: "ALIVE" } }));
  return false;
}

// Retire: refused only by a living occupant. Nothing else blocks it — that's
// the whole point of a soft, reversible removal.
async function retirePlace(prisma, kind, id) {
  if (await hasLivingOccupant(prisma, kind, id)) {
    return { ok: false, error: "A living character is standing here. Move them first." };
  }
  const model = modelFor(prisma, kind);
  const row = await model.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "That place no longer exists." };
  if (row.retiredAt) return { ok: true, alreadyRetired: true };
  await model.update({ where: { id }, data: { retiredAt: new Date() } });
  return { ok: true };
}

async function unretirePlace(prisma, kind, id) {
  const model = modelFor(prisma, kind);
  await model.update({ where: { id }, data: { retiredAt: null } });
  return { ok: true };
}

// Everything that refuses a hard delete, as plain strings for the UI. An
// empty array means the place is genuinely untouched and hardDeletePlace may
// proceed. Never a cascade — a GM sees the list and clears it by hand, or
// doesn't.
async function hardDeleteBlockers(prisma, kind, id) {
  const blockers = [];

  if (kind === "zone") {
    const [characters, locations, roleStart, cavingRolls] = await Promise.all([
      prisma.character.count({ where: { zoneId: id } }),
      prisma.location.count({ where: { zoneId: id } }),
      prisma.role.count({ where: { startingZoneId: id } }),
      prisma.cavingRoll.count({ where: { zoneId: id } }),
    ]);
    if (characters) blockers.push(`${characters} character${characters === 1 ? "" : "s"} call this zone home`);
    if (locations) blockers.push(`${locations} location${locations === 1 ? "" : "s"} still belong to this zone`);
    if (roleStart) blockers.push(`${roleStart} role${roleStart === 1 ? "" : "s"} start new characters here`);
    if (cavingRolls) blockers.push(`${cavingRolls} caving roll${cavingRolls === 1 ? "" : "s"} reference this zone`);
    return blockers;
  }

  if (kind === "location") {
    const [
      characters,
      vantages,
      rooms,
      links,
      structures,
      roleStart,
      threatSpawns,
      cavingRolls,
      quests,
    ] = await Promise.all([
      prisma.character.count({ where: { locationId: id } }),
      prisma.vantage.count({ where: { locationId: id } }),
      prisma.room.count({ where: { locationId: id } }),
      prisma.locationLink.count({ where: { OR: [{ aId: id }, { bId: id }] } }),
      prisma.structure.count({ where: { locationId: id } }),
      prisma.role.count({ where: { startingLocationId: id } }),
      prisma.threatSpawn.count({ where: { locationId: id } }),
      prisma.cavingRoll.count({ where: { locationId: id } }),
      prisma.quest.count({ where: { locationId: id } }),
    ]);
    if (characters) blockers.push(`${characters} character${characters === 1 ? "" : "s"} stand here`);
    if (vantages) blockers.push(`${vantages} character${vantages === 1 ? "" : "s"} are still watching this location`);
    if (rooms) blockers.push(`${rooms} room${rooms === 1 ? "" : "s"} still belong to this location`);
    if (links) blockers.push(`${links} travel link${links === 1 ? "" : "s"} connect to this location`);
    if (structures) blockers.push(`${structures} structure${structures === 1 ? "" : "s"} stand here`);
    if (roleStart) blockers.push(`${roleStart} role${roleStart === 1 ? "" : "s"} start new characters here`);
    if (threatSpawns) blockers.push(`${threatSpawns} pending threat spawn${threatSpawns === 1 ? "" : "s"} name this location`);
    if (cavingRolls) blockers.push(`${cavingRolls} caving roll${cavingRolls === 1 ? "" : "s"} reference this location`);
    if (quests) blockers.push(`${quests} quest${quests === 1 ? "" : "s"} reference this location`);
    return blockers;
  }

  if (kind === "room") {
    // ⬢ are a RoomTag stack now, so they would be counted twice — once as an
    // item stack and once as themselves. The item count skips them and keeps
    // its own line, because "12 ⬢ are stashed here" says more to a GM about to
    // delete a room than "1 item stack".
    const [guests, playerThreads, faction, tags, resources, room] = await Promise.all([
      prisma.roomGuest.count({ where: { roomId: id } }),
      prisma.playerThread.count({ where: { roomId: id } }),
      prisma.faction.count({ where: { siloRoomId: id } }),
      prisma.roomTag.count({ where: { roomId: id, tag: { slug: { not: RESOURCES_SLUG } } } }),
      readRoomResources(prisma, id),
      prisma.room.findUnique({ where: { id }, select: { questId: true } }),
    ]);
    if (guests) blockers.push(`${guests} guest${guests === 1 ? "" : "s"} have a standing invite to this room`);
    if (playerThreads) blockers.push(`${playerThreads} conversation${playerThreads === 1 ? "" : "s"} are anchored to this room`);
    if (faction) blockers.push(`${faction} faction${faction === 1 ? "" : "s"} bank here`);
    if (tags) blockers.push(`${tags} item stack${tags === 1 ? "" : "s"} are stashed here`);
    if (resources) blockers.push(`${resources} ⬢ are stashed here`);
    if (room?.questId) blockers.push("A quest minted this room — close the quest first");
    return blockers;
  }

  throw new Error(`placeDeletable: unknown kind "${kind}"`);
}

// Best-effort Discord teardown, the same posture syncZones/sync.js's pass 4
// takes: never let a failed REST call stop the database from reflecting what
// the GM asked for.
async function deleteDiscordFootprint(prisma, kind, row) {
  try {
    if (kind === "zone") {
      if (row.discordSummaryChannelId) await discordRest.deleteChannel(row.discordSummaryChannelId);
      if (row.discordRoleId) await discordRest.deleteGuildRole(row.discordRoleId);
      if (row.gmRoleId) await discordRest.deleteGuildRole(row.gmRoleId);
    } else if (kind === "location") {
      if (row.discordChannelId) await discordRest.deleteChannel(row.discordChannelId);
    } else if (kind === "room") {
      if (row.discordThreadId) await discordRest.deleteThread(row.discordThreadId);
    }
  } catch (err) {
    console.error(`placeDeletable: Discord teardown for ${kind} ${row.id} failed:`, err?.message ?? err);
  }
}

// Only ever called after hardDeleteBlockers() came back empty, and re-checks
// that itself rather than trusting a stale read.
async function hardDeletePlace(prisma, kind, id) {
  const blockers = await hardDeleteBlockers(prisma, kind, id);
  if (blockers.length) return { ok: false, blockers };

  const model = modelFor(prisma, kind);
  const row = await model.findUnique({ where: { id } });
  if (!row) return { ok: false, blockers: ["That place no longer exists."] };

  await deleteDiscordFootprint(prisma, kind, row);
  await model.delete({ where: { id } });
  return { ok: true };
}

module.exports = {
  hasLivingOccupant,
  retirePlace,
  unretirePlace,
  hardDeleteBlockers,
  hardDeletePlace,
};
