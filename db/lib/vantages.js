// The per-turn fog of war, and the ONE module reading or writing Vantage —
// same rule db/lib/locationVisits.js keeps for LocationVisit and
// db/lib/locationGraph.js keeps for LocationLink. Deliberately NOT on the
// @lifeweb/db barrel; require it by path.
//
// A vantage is a Location you WALKED INTO this turn and are no longer standing
// in: you go on watching it, read-only, until you leave the zone or the turn
// shifts. Either of those puts every light out at once.
//
// Where you STAND is never a row — that is Character.locationId, as it always
// was. Keeping it out means the turn wipe is a bare deleteMany with nothing to
// put back, and there is still only one writer of "here".
//
// Every read filters on BOTH snapshot columns: the turn it was lit in and the
// zone it sits in. So a wipe that failed to run leaves rows that already read
// as dark, and the channel doctor takes their overwrites off on its next pass.
// The wipes are the belt; this filter is the braces.

// What a reader needs to act on a row: where to send the REST call, and who to
// send it about. Shared by every query below so the shapes can't drift.
const VANTAGE_SELECT = {
  id: true,
  characterId: true,
  locationId: true,
  zoneId: true,
  turnId: true,
  location: { select: { id: true, name: true, zoneId: true, discordChannelId: true } },
};

async function openTurnId(prisma) {
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  return turn?.id ?? null;
}

// Walking out of somewhere leaves a light on behind you. Called from
// locationMove.js#applyLocationMoveSideEffects, and only for a WALKED crossing
// inside one zone — a teleport, a rite, a spawn or a staged "Relocate to"
// never came that way, so they leave nothing lit.
//
// Also clears any row on the DESTINATION: you are standing there now, and
// standing is not a row. That is what lets somebody walk back the way they
// came without holding two states of the same channel.
async function lightVantage(prisma, { characterId, fromLocationId, toLocationId, zoneId, turnId }) {
  if (!characterId || !fromLocationId || !zoneId || !turnId) return null;
  if (fromLocationId === toLocationId) return null;

  if (toLocationId) {
    await prisma.vantage.deleteMany({ where: { characterId, locationId: toLocationId } });
  }

  // Upsert rather than create: walking A -> B -> A -> B re-lights A with the
  // current turn, which is also how a row left over from an earlier turn heals.
  return prisma.vantage.upsert({
    where: { characterId_locationId: { characterId, locationId: fromLocationId } },
    create: { characterId, locationId: fromLocationId, zoneId, turnId },
    update: { zoneId, turnId, litAt: new Date() },
    select: VANTAGE_SELECT,
  });
}

// Standing somewhere is never a row, so arriving anywhere puts that row out —
// however the character arrived. lightVantage does this too for the walking
// case; this is the same clear for a teleport, a rite or a staged relocation
// INSIDE the zone, none of which light anything but any of which can land on a
// street the character was watching. Without it that place would be drawn twice
// in the left column, once as Here and once as Elsewhere.
async function clearVantage(prisma, characterId, locationId) {
  if (!characterId || !locationId) return;
  await prisma.vantage.deleteMany({ where: { characterId, locationId } });
}

// The lit places for one character, as the whole game should see them. Takes
// the character row rather than an id so the zone check is against the zone
// they are in NOW — a row for a zone they have since left is dark, whether or
// not the wipe that should have removed it ran.
async function vantagesFor(prisma, character) {
  if (!character?.id || !character.zoneId) return [];
  const turnId = await openTurnId(prisma);
  if (!turnId) return [];

  return prisma.vantage.findMany({
    where: { characterId: character.id, zoneId: character.zoneId, turnId },
    orderBy: { litAt: "asc" },
    select: VANTAGE_SELECT,
  });
}

// Every valid row in the game, one query, for the channel doctor's occupancy
// sweep. Validity is the same two-column filter as above, applied per row
// against the character's CURRENT zone — so a stale row simply doesn't come
// back and the sweep closes its channel.
async function allVantages(prisma, alive) {
  const turnId = await openTurnId(prisma);
  if (!turnId) return [];

  const zoneOf = new Map(
    (alive ?? [])
      .filter((c) => c.discordUserId && c.discordMirrored && c.zoneId)
      .map((c) => [c.id, c.zoneId]),
  );
  if (zoneOf.size === 0) return [];

  const rows = await prisma.vantage.findMany({
    where: { turnId, characterId: { in: [...zoneOf.keys()] } },
    select: VANTAGE_SELECT,
  });
  return rows.filter((row) => zoneOf.get(row.characterId) === row.zoneId);
}

// Leaving the zone puts every light out. Returns what it deleted so the caller
// can take the Discord overwrites off — nothing else knows which channels were
// open.
async function dropVantages(prisma, characterId) {
  if (!characterId) return [];
  const rows = await prisma.vantage.findMany({ where: { characterId }, select: VANTAGE_SELECT });
  if (rows.length === 0) return [];
  await prisma.vantage.deleteMany({ where: { characterId } });
  return rows;
}

// The turn shift, from the side-effect thunk. `keepTurnId` is the turn that
// has just OPENED: anything lit under it was lit by a relocation inside this
// very push and must survive, everything older goes. Returns the rows with
// their character's Discord id so the caller can close each channel.
async function expireVantages(prisma, { keepTurnId = null } = {}) {
  const where = keepTurnId ? { turnId: { not: keepTurnId } } : {};
  const rows = await prisma.vantage.findMany({
    where,
    select: {
      ...VANTAGE_SELECT,
      character: { select: { id: true, discordUserId: true, discordMirrored: true, status: true } },
    },
  });
  if (rows.length === 0) return [];
  await prisma.vantage.deleteMany({ where });
  return rows;
}

module.exports = {
  lightVantage,
  clearVantage,
  vantagesFor,
  allVantages,
  dropVantages,
  expireVantages,
};
