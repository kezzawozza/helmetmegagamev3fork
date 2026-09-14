// The Nuclear Device, the Datacard that points at it, and the countdown. WHERE it is lives on the tag rows, read fresh every use. WHETHER it is armed
// lives on GameState.nukeArmedTurn — global, not a tag, since a tag's holder could die inside the window and silently cancel the blast. Explosion: db/lib/nukeExplosionPass.js.

const { soundRange } = require("./locationGraph");

const DEVICE_SLUG = "nuclear-device";
const DATACARD_SLUG = "nuclear-datacard";

// What a destroying room (Spillway, Latrines — Room.destroysContents) refuses to eat — a deliberately explicit list, since `removable: false` is
// also carried by monster corpses players ARE allowed to tip in. Tipped in, the bomb just sits in the room's stash — no way to remove it from the game.
const INDESTRUCTIBLE_SLUGS = new Set([DEVICE_SLUG, DATACARD_SLUG]);

// Turns between arming and the fireball (TAGS.md §5 duration counting): armed while turn T is open, fires as turn T+1 closes.
const NUKE_FUSE_TURNS = 2;

// Where the device physically is, as a locationId, or null. THREE homes: a character, a room stash, or inside a CRATE (crate contents are a JSON
// column, Tag.crateContents, not a relation, so `where: { tagId }` won't find one there).
async function deviceLocationId(prisma) {
  const tag = await prisma.tag.findUnique({ where: { slug: DEVICE_SLUG }, select: { id: true } });
  if (!tag) return null;

  const held = await prisma.characterTag.findFirst({
    where: { tagId: tag.id, quantity: { gt: 0 }, character: { locationId: { not: null } } },
    select: { character: { select: { locationId: true } } },
  });
  if (held?.character?.locationId) return held.character.locationId;

  const stashed = await prisma.roomTag.findFirst({
    where: { tagId: tag.id, quantity: { gt: 0 } },
    select: { room: { select: { locationId: true } } },
  });
  if (stashed?.room?.locationId) return stashed.room.locationId;

  const crates = await prisma.tag.findMany({
    where: { crateContents: { not: null } },
    select: { id: true, crateContents: true },
  });
  const carrying = crates
    .filter((c) => Array.isArray(c.crateContents) && c.crateContents.some((line) => line?.tagId === tag.id))
    .map((c) => c.id);
  if (carrying.length === 0) return null;

  const crateHeld = await prisma.characterTag.findFirst({
    where: { tagId: { in: carrying }, quantity: { gt: 0 }, character: { locationId: { not: null } } },
    select: { character: { select: { locationId: true } } },
  });
  if (crateHeld?.character?.locationId) return crateHeld.character.locationId;

  const crateStashed = await prisma.roomTag.findFirst({
    where: { tagId: { in: carrying }, quantity: { gt: 0 } },
    select: { room: { select: { locationId: true } } },
  });
  return crateStashed?.room?.locationId ?? null;
}

// What the datacard says to somebody at `fromLocationId`. `via` is soundRange's BFS from the DEVICE outward with throughHidden.
async function pointerReading(prisma, fromLocationId) {
  const target = await deviceLocationId(prisma);
  if (!target) return { found: false };
  if (!fromLocationId) return { found: true, here: false, via: null };
  if (target === fromLocationId) return { found: true, here: true, via: null };

  const reach = await soundRange(prisma, target, Infinity, { throughHidden: true });
  const mine = reach.find((row) => row.locationId === fromLocationId) ?? null;
  return { found: true, here: false, via: mine?.viaName ?? null };
}

function pointerLine(reading) {
  if (!reading.found) return "» *The datacard finds nothing to point at.*";
  if (reading.here) return "» *The datacard stopped pointing. The nuclear device is here.*";
  if (!reading.via) return "» *The datacard strains, and settles. It cannot find a way there.*";
  return `» *The datacard points towards ${reading.via}.*`;
}

module.exports = {
  DEVICE_SLUG,
  DATACARD_SLUG,
  INDESTRUCTIBLE_SLUGS,
  NUKE_FUSE_TURNS,
  deviceLocationId,
  pointerReading,
  pointerLine,
};
