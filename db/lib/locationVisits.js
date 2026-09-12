// What a character knows of the map — the fog behind /map.
//
// The ONE module that reads or writes LocationVisit, for the same reason
// db/lib/locationGraph.js is the one module that touches LocationLink: the
// rule about what a player may see is a policy, and a second copy of it would
// drift into a leak. Nothing here decides passability itself — every question
// about an edge is asked of locationGraph.
//
// Two grades of knowing. `stood` is "I have been here". A row without it is "I
// have seen this from next door", which draws hollow and carries a name but no
// description. Neither is ever unlearned: seen once, drawn forever, so the map
// only ever grows.
//
// Deliberately NOT on the @lifeweb/db barrel; require it by path.
const { travelOptions } = require("./locationGraph");
const { accessibleRooms, roomAccessKeys } = require("./roomAccess");

// Called on arrival — from applyLocationMoveSideEffects, which is the one
// function every writer of Character.locationId runs (MAP.md §4). Hooking
// there rather than in performLocationMove is what stops a GM teleport, a
// character's first placement or the turn's arrival pass from leaving a hole
// in somebody's map.
//
// `character` wants tags loaded (CHARACTER_SELECT shape is enough);
// travelOptions falls back to querying them if not.
async function recordArrival(prisma, character, locationId) {
  if (!character?.id || !locationId) return;

  await prisma.locationVisit.upsert({
    where: { characterId_locationId: { characterId: character.id, locationId } },
    create: { characterId: character.id, locationId, stood: true },
    update: { stood: true },
  });

  // Everything one step away, as a sighting. travelOptions rather than
  // linksFor: it has already dropped the ways this character cannot see, so a
  // hidden crawl they lack the tag for is never recorded and can never be
  // revealed by the map later.
  const neighbours = await travelOptions(prisma, character, locationId);
  if (neighbours.length === 0) return;

  // skipDuplicates is load-bearing, not an optimisation. It is what makes this
  // write unable to touch a row that already exists — so a place the character
  // has actually STOOD in can never be downgraded to a bare sighting by
  // walking past its door afterwards.
  await prisma.locationVisit.createMany({
    data: neighbours.map((row) => ({
      characterId: character.id,
      locationId: row.location.id,
      stood: false,
    })),
    skipDuplicates: true,
  });
}

// The map a character wakes up with (db/lib/startingMemories.js). Called once,
// from createCharacter, after the tags are committed — travelOptions reads
// them, so a fisherman's boat-gated water ways are visible by the time this
// runs. Pass `character.tags` loaded, or every location below re-queries them.
//
// recordArrival per location rather than one bulk write, so the hidden-way rule
// above is obeyed rather than re-derived. A slug naming a Location that no
// longer exists is absent from the lookup and skipped.
async function seedMemories(prisma, character, locationSlugs) {
  if (!character?.id || !locationSlugs?.length) return;

  const locations = await prisma.location.findMany({
    where: { slug: { in: locationSlugs } },
    select: { id: true },
  });

  for (const location of locations) {
    // Placement already recorded where they stand, neighbours and all.
    if (location.id === character.locationId) continue;
    await recordArrival(prisma, character, location.id);
  }
}

// Everything this character knows, as two sets. `stood` is a subset of `seen`
// — a place you have been is also a place you have seen — so a caller asking
// "is this on the map at all" checks `seen`.
async function knownLocations(prisma, characterId) {
  const empty = { stood: new Set(), seen: new Set() };
  if (!characterId) return empty;

  const rows = await prisma.locationVisit.findMany({
    where: { characterId },
    select: { locationId: true, stood: true },
  });

  const stood = new Set();
  const seen = new Set();
  for (const row of rows) {
    seen.add(row.locationId);
    if (row.stood) stood.add(row.locationId);
  }
  return { stood, seen };
}

// The rooms this character could legitimately NAME: inside a Location they have
// STOOD in, and behind a door that opens for them. Both halves matter and both
// already exist — this is the pair web/app/(app)/map/actions.js#roomsInside
// composes, lifted out because a picker and the server action that re-checks it
// must not be able to drift apart.
//
// `stood`, not `seen`: a room is a door in a wall you have to have stood in
// front of, and listing the Cathedral's private rooms to somebody who has only
// glimpsed it from the Square would be telling them about a door they have
// never seen. `accessibleRooms` is the door itself, and it is the same
// predicate the channel doctor, the Secret rooms? button and the Transfer
// dialog use, so all of them agree.
//
// `where` narrows the query further (the silo picker passes the faction's own
// zone). Lives here rather than in roomAccess.js because locationGraph already
// requires that module, so the arrow has to point this way.
async function knownRooms(prisma, characterId, where = {}) {
  if (!characterId) return [];

  const [{ stood }, keys] = await Promise.all([
    knownLocations(prisma, characterId),
    roomAccessKeys(prisma, characterId),
  ]);
  if (stood.size === 0) return [];

  const rooms = await prisma.room.findMany({
    where: { ...where, locationId: { in: [...stood] } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      kind: true,
      accessTagSlugs: true,
      location: { select: { name: true, zoneId: true, zone: { select: { name: true } } } },
    },
  });

  return accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds);
}

module.exports = { recordArrival, seedMemories, knownLocations, knownRooms };
