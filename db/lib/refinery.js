// The Godard Factory floor: a day that pays in cubes instead of ⬢. Reached
// by the Refine button (web/app/(app)/character/actions/refine.js). A
// Location attribute, not a slug: `refinery: true` in docs/zones.yaml,
// checked through db/lib/locationAttributes.js#hasAttribute. One Godflesh in,
// eight Squeeze out, once per day. Input may be in the worker's own hands OR
// any Room stash at the Location they can enter — nobody should have to carry
// a 28 lb lump around the floor all day to prove they own it. Prisma is a
// parameter, never a require (db/lib/dm.js convention).
const { accessibleRooms } = require("./roomAccess");
const { addToStack, dropCharacterTag, dropRoomTag, addToRoomStack } = require("./tagWrites");
const { hasAttribute, REFINERY_ATTRIBUTE } = require("./locationAttributes");
const { GODFLESH_SLUG } = require("./godflesh");

const REFINERY_OUTPUT_SLUG = "squeeze";
// The economy is balanced on this number (docs/systemdocs/FACTORY.md).
const REFINERY_YIELD = 8;

function isRefinery(location) {
  return hasAttribute(location, REFINERY_ATTRIBUTE);
}

// { kind: "held" } | { kind: "room", roomId } | null. `rooms` is already
// narrowed to ones the worker may enter.
function inputSource({ holdsInput = false, rooms = [] } = {}) {
  if (holdsInput) return { kind: "held" };
  const room = rooms[0];
  return room ? { kind: "room", roomId: room.id } : null;
}

// The bulk half: two queries for a whole roster rather than two per
// character. refineryInput below wraps it for the one character the Refine
// button is acting for.
async function loadRefineryStashes(prisma, locationIds) {
  if (!locationIds?.length) return { roomsByLocation: new Map(), guestsByCharacter: new Map() };
  const rooms = await prisma.room.findMany({
    where: {
      locationId: { in: locationIds },
      tags: { some: { quantity: { gt: 0 }, tag: { slug: GODFLESH_SLUG } } },
    },
    select: { id: true, kind: true, accessTagSlugs: true, locationId: true },
  });
  const guests = rooms.length
    ? await prisma.roomGuest.findMany({
        where: { roomId: { in: rooms.map((r) => r.id) } },
        select: { roomId: true, characterId: true },
      })
    : [];

  const roomsByLocation = new Map();
  for (const room of rooms) {
    if (!roomsByLocation.has(room.locationId)) roomsByLocation.set(room.locationId, []);
    roomsByLocation.get(room.locationId).push(room);
  }
  const guestsByCharacter = new Map();
  for (const row of guests) {
    if (!guestsByCharacter.has(row.characterId)) guestsByCharacter.set(row.characterId, new Set());
    guestsByCharacter.get(row.characterId).add(row.roomId);
  }
  return { roomsByLocation, guestsByCharacter };
}

// Does this worker have anything to refine? Pure, so a bulk caller can
// ask it once per character off state it already loaded.
function refineryInputFor({ characterId, locationId, heldSlugs }, stashes) {
  const holdsInput = heldSlugs.has(GODFLESH_SLUG);
  const rooms = accessibleRooms(
    stashes?.roomsByLocation?.get(locationId) ?? [],
    heldSlugs,
    stashes?.guestsByCharacter?.get(characterId) ?? new Set(),
  );
  return inputSource({ holdsInput, rooms });
}

// The single-character async form, for the Refine button.
async function refineryInput(prisma, character) {
  if (!character?.id || !character?.locationId) return null;
  const [stashes, held, guests] = await Promise.all([
    loadRefineryStashes(prisma, [character.locationId]),
    prisma.characterTag.findMany({
      where: { characterId: character.id, quantity: { gt: 0 } },
      select: { tag: { select: { slug: true } } },
    }),
    prisma.roomGuest.findMany({ where: { characterId: character.id }, select: { roomId: true } }),
  ]);
  stashes.guestsByCharacter.set(character.id, new Set(guests.map((g) => g.roomId)));
  return refineryInputFor(
    {
      characterId: character.id,
      locationId: character.locationId,
      heldSlugs: new Set(held.map((h) => h.tag.slug)),
    },
    stashes,
  );
}

// Runs one refining shift. Returns the snapshot to stamp on
// Action.appliedEffects (null if nothing to work) — what Undo reads, never
// live state (docs/systemdocs/REQUESTS.md §2).
async function applyRefinery(tx, characterId, locationId) {
  const location = await tx.location.findUnique({
    where: { id: locationId ?? "" },
    select: { id: true, attributes: true },
  });
  if (!isRefinery(location)) return null;

  const [input, output] = await Promise.all([
    tx.tag.findUnique({ where: { slug: GODFLESH_SLUG }, select: { id: true } }),
    tx.tag.findUnique({ where: { slug: REFINERY_OUTPUT_SLUG }, select: { id: true, stackable: true } }),
  ]);
  if (!input || !output) {
    console.error(
      `Refinery: missing "${GODFLESH_SLUG}" or "${REFINERY_OUTPUT_SLUG}" tag — run npm run db:sync-tags.`,
    );
    return null;
  }

  const [held, guests, rooms] = await Promise.all([
    tx.characterTag.findMany({
      where: { characterId, quantity: { gt: 0 } },
      select: { tag: { select: { slug: true } } },
    }),
    tx.roomGuest.findMany({ where: { characterId }, select: { roomId: true } }),
    tx.room.findMany({
      where: { locationId, tags: { some: { tagId: input.id, quantity: { gt: 0 } } } },
      select: { id: true, kind: true, accessTagSlugs: true },
    }),
  ]);
  const heldSlugs = new Set(held.map((h) => h.tag.slug));
  const source = inputSource({
    holdsInput: heldSlugs.has(GODFLESH_SLUG),
    rooms: accessibleRooms(rooms, heldSlugs, new Set(guests.map((g) => g.roomId))),
  });
  // `{ empty: true }`, not null: null means "not a refinery"; this means "you
  // spent your day on the floor and there was nothing to work" — the NORMAL
  // case when the stash runs thin.
  if (!source) return { empty: true };

  if (source.kind === "held") {
    await dropCharacterTag(tx, characterId, input.id, 1);
  } else if (!(await dropRoomTag(tx, source.roomId, input.id, 1)).ok) {
    // Somebody else's shift took the last lump first — a race the refine
    // pass's single-snapshot design invites, not an anomaly.
    return { empty: true };
  }

  await addToStack(tx, characterId, output.id, REFINERY_YIELD, {
    source: "EVENT",
    stackable: output.stackable,
  });

  return {
    consumed: { tagId: input.id, slug: GODFLESH_SLUG, quantity: 1, ...source },
    produced: { tagId: output.id, slug: REFINERY_OUTPUT_SLUG, quantity: REFINERY_YIELD },
  };
}

// Exact inverse: cubes come off, the lump returns to where it was taken from.
async function revertRefinery(tx, characterId, snapshot) {
  if (!snapshot || snapshot.empty) return;
  const consumed = snapshot?.consumed;
  const produced = snapshot?.produced;
  if (produced?.tagId) {
    await dropCharacterTag(tx, characterId, produced.tagId, produced.quantity ?? REFINERY_YIELD);
  }
  if (!consumed?.tagId) return;
  if (consumed.kind === "room" && consumed.roomId) {
    await addToRoomStack(tx, consumed.roomId, consumed.tagId, consumed.quantity ?? 1);
  } else {
    await addToStack(tx, characterId, consumed.tagId, consumed.quantity ?? 1, {
      source: "EVENT",
      stackable: true,
    });
  }
}

module.exports = {
  REFINERY_YIELD,
  REFINERY_OUTPUT_SLUG,
  isRefinery,
  loadRefineryStashes,
  refineryInputFor,
  refineryInput,
  applyRefinery,
  revertRefinery,
};
