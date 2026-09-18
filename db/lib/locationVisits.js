// The fog behind /map. The ONE module reading or writing LocationVisit, same
// reason db/lib/locationGraph.js is the one for LocationLink. `stood` is "I have been here"; without it, "seen from next door" (hollow). Deliberately NOT on the @lifeweb/db barrel — require by path.
const { travelOptions } = require("./locationGraph");

// Called from applyLocationMoveSideEffects, run by every writer of Character.locationId (MAP.md §4).
async function recordArrival(prisma, character, locationId) {
  if (!character?.id || !locationId) return;

  await prisma.locationVisit.upsert({
    where: { characterId_locationId: { characterId: character.id, locationId } },
    create: { characterId: character.id, locationId, stood: true },
    update: { stood: true },
  });

  // travelOptions, not linksFor — a hidden crawl the character lacks the tag for is never recorded.
  const neighbours = await travelOptions(prisma, character, locationId);
  if (neighbours.length === 0) return;

  // skipDuplicates is load-bearing — a STOOD place can never be downgraded.
  await prisma.locationVisit.createMany({
    data: neighbours.map((row) => ({
      characterId: character.id,
      locationId: row.location.id,
      stood: false,
    })),
    skipDuplicates: true,
  });
}

// db/lib/startingMemories.js. recordArrival per location, not one bulk write, so the hidden-way rule above is obeyed rather than re-derived.
async function seedMemories(prisma, character, locationSlugs) {
  if (!character?.id || !locationSlugs?.length) return;

  const locations = await prisma.location.findMany({
    where: { slug: { in: locationSlugs } },
    select: { id: true },
  });

  for (const location of locations) {
    if (location.id === character.locationId) continue;
    await recordArrival(prisma, character, location.id);
  }
}

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

// Deliberately NOT recordArrival/seedMemories reused — those also paint
// NEIGHBOURS, leaking a cave-adjacent Location as a "sighting". `stood: false` throughout; `skipDuplicates` keeps a stood-in Location from ever downgrading.
async function revealSurface(prisma, characterId) {
  if (!characterId) return;
  const locations = await prisma.location.findMany({
    where: { zone: { kind: "SURFACE" } },
    select: { id: true },
  });
  if (locations.length === 0) return;
  await prisma.locationVisit.createMany({
    data: locations.map((location) => ({ characterId, locationId: location.id, stood: false })),
    skipDuplicates: true,
  });
}

module.exports = { recordArrival, seedMemories, revealSurface, knownLocations };
