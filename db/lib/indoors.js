// Parking a cart or a mount — at an indoor door, or on a way too narrow for it — and taking the road
// kit back up on the way out for whoever asked (CARRY.md §3, MAP.md §3).
// A Location marked `indoors: true` unequips anything stowable on arrival, but only underground
// (`zone.kind === "CAVE_LEVEL"`) — every Caves/Depths Location is `indoors: true`, so that's the one
// place a roof still costs the reins; a surface roof no longer does — unless it also carries the
// `wheels` attribute (Godard Factory, Customs, the Depot — built to be driven into). A LocationLink
// marked `onFoot: true` unequips on crossing instead of refusing it. Nothing is ever DROPPED for this
// — settleCarry's overflow just makes someone Overburdened. Takes `prisma`, off the @lifeweb/db barrel (carry.js posture).
const { STOWABLE_SLUGS } = require("./mounts");
const { parksMounts } = require("./locationAttributes");
const { blockerFor, ACT } = require("./incapacitation");
const { MOTION_SICKNESS_SLUG } = require("./constants");

// Unequips every stowable a character currently has out. Returns display names for a caller to DM.
async function unequipStowables(prisma, characterId) {
  const held = await prisma.characterTag.findMany({
    where: { characterId, equipped: true, tag: { slug: { in: [...STOWABLE_SLUGS] } } },
    select: { id: true, tag: { select: { name: true } } },
  });
  if (held.length === 0) return [];

  await prisma.characterTag.updateMany({
    where: { id: { in: held.map((ct) => ct.id) } },
    // equippedQuantity too, not just the boolean — left stale it spends a slot nobody can see is spent.
    data: { equipped: false, equippedQuantity: 0 },
  });
  return held.map((ct) => ct.tag.name);
}

// Arriving somewhere indoors.
async function parkMountsIndoors(prisma, characterId, locationId) {
  if (!characterId || !locationId) return [];
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { indoors: true, attributes: true, zone: { select: { kind: true } } },
  });
  // Not the column — an indoors Location wearing `wheels` is one you drive
  // into (locationAttributes.js#parksMounts).
  if (!parksMounts(location)) return [];
  return unequipStowables(prisma, characterId);
}

// Crossing a way too narrow for what they had out. `link` is whatever
// db/lib/locationGraph.js#linkBetween found for this move, or null on a first
// placement — nothing to dismount for, since nobody crossed anything.
async function dismountForNarrowWay(prisma, characterId, link) {
  if (!characterId || !link?.onFoot) return [];
  return unequipStowables(prisma, characterId);
}

// Which rows come back out for a character with Character.autoMount on. Pure: held rows in, rows to
// equip out. Anything already in the MOUNT slot means nothing happens — that one check covers every
// clash equipOne has to name (a boat is poled not ridden, an Ovum is already under you). Motion
// Sickness keeps the rider on foot but still tows the cart, and the ACT blocker is the same one that
// stops a bound or unconscious character working the equip board.
// RIDE_ORDER is a fixed preference, not computed: Thoroughbred (two crossings), Warbeast (seats), Horse,
// Motorcycle. (A shod Horse is worth two as well — fastTravelBonus — but that owner can pick by hand.)
// Every FAST_TRAVEL_SLUGS entry belongs here; the test holds the two lists together.
const RIDE_ORDER = ["arelitz-thoroughbred", "arelitz-warbeast", "horse", "motorcycle"];

function mountsToTakeUp(characterTags = []) {
  if (blockerFor(characterTags, ACT)) return [];
  if (characterTags.some((ct) => ct.tag.equipSlot === "MOUNT" && ct.equippedQuantity > 0)) return [];
  const stowed = characterTags.filter((ct) => ct.quantity > 0 && ct.equippedQuantity === 0);
  const out = [];
  if (!characterTags.some((ct) => ct.tag.slug === MOTION_SICKNESS_SLUG)) {
    const ride = RIDE_ORDER.map((slug) => stowed.find((ct) => ct.tag.slug === slug)).find(Boolean);
    if (ride) out.push(ride);
  }
  const cart = stowed.find((ct) => ct.tag.slug === "cart");
  if (cart) out.push(cart);
  return out;
}

// Leaving again — the other half of parkMountsIndoors, for whoever turned the switch on. Same row lock
// the sheet's equip takes (equipActions.js), so a tap on the equip board and an arrival landing in the
// same instant serialize. Silent by design: no DM, the sheet shows what's out. Returns the names anyway.
async function takeUpMountsOutdoors(prisma, characterId, locationId) {
  if (!characterId || !locationId) return [];
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { indoors: true, attributes: true },
  });
  if (parksMounts(location)) return [];
  // Nearly every arrival has the switch off, so that is read cheaply before anything is locked. ALIVE:
  // the turn's relocation pass drags corpses through the same arrival (turnSideEffects.js).
  const wants = { id: characterId, status: "ALIVE", autoMount: true };
  if (!(await prisma.character.findFirst({ where: wants, select: { id: true } }))) return [];
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
    // Re-read under the lock: the sheet may have moved between the two.
    const character = await tx.character.findFirst({
      where: wants,
      select: {
        tags: {
          select: { id: true, quantity: true, equippedQuantity: true, tag: { select: { slug: true, name: true, equipSlot: true } } },
        },
      },
    });
    if (!character) return [];
    const rows = mountsToTakeUp(character.tags);
    if (rows.length === 0) return [];
    // 1, not an increment: none of these stacks in the slot, and parking wrote 0 (unequipStowables).
    await tx.characterTag.updateMany({
      where: { id: { in: rows.map((ct) => ct.id) } },
      data: { equipped: true, equippedQuantity: 1 },
    });
    return rows.map((ct) => ct.tag.name);
  });
}

// The sentence the DM carries. Kept here beside the rule so the bot and the
// web app can never word it differently.
function parkedMessage(names, locationName) {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `You leave your ${list} outside ${locationName}. You can take ${names.length === 1 ? "it" : "them"} up again on your way out.`;
}

// Same shape, for a crossing rather than a doorway — there is no "outside
// {place}" to name, since the way itself was the obstacle.
function dismountedMessage(names) {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `The way was too narrow for your ${list}. You leave ${names.length === 1 ? "it" : "them"} behind and go on foot.`;
}

module.exports = {
  parkMountsIndoors,
  parkedMessage,
  dismountForNarrowWay,
  dismountedMessage,
  mountsToTakeUp,
  takeUpMountsOutdoors,
};
