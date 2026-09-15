// Parking a cart or a mount — at an indoor door, or on a way too narrow for it (CARRY.md §3, MAP.md §3).
// A Location marked `indoors: true` unequips anything stowable on arrival, but only underground
// (`zone.kind === "CAVE_LEVEL"`) — every Caves/Depths Location is `indoors: true`, so that's the one
// place a roof still costs the reins; a surface roof no longer does — unless it also carries the
// `wheels` attribute (Godard Factory, Customs, the Depot — built to be driven into). A LocationLink
// marked `onFoot: true` unequips on crossing instead of refusing it. Nothing is ever DROPPED for this
// — settleCarry's overflow just makes someone Overburdened. Takes `prisma`, off the @lifeweb/db barrel (carry.js posture).
const { STOWABLE_SLUGS } = require("./mounts");
const { parksMounts } = require("./locationAttributes");

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
};
