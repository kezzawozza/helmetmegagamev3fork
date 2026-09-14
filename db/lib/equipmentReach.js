// "Is that kit within reach?" — the one question Craft and Heal both ask about standing equipment
// (docs/systemdocs/CRAFTING.md, TAGS.md §5c). Two kits use this: WORKSHOP EQUIPMENT and SURGICAL
// EQUIPMENT/PORTABLE SURGICAL PACK (see needsSurgicalSite() and healCharacterRequestImpl for the
// pack's −1 die penalty). Reach is NOT re-derived here — same predicate the private-room threads use
// (db/lib/roomAccess.js#accessibleRooms, web/lib/transferReach.js). Takes `prisma`, off the barrel (db/lib/dm.js convention).
const { accessibleRooms, roomAccessKeys } = require("./roomAccess");
const { structuresAt } = require("./structures");

// True when the character holds the tag, a Room stash at their Location has it, or a COMPLETE
// structure there provides it (db/lib/structures.js). `character` needs { id, locationId }. Held tags
// are re-read, not taken from a passed row — every caller is a server action re-checking a client claim.
async function hasEquipmentInReach(prisma, character, slug) {
  if (!character?.id || !slug) return false;

  const held = await prisma.characterTag.findFirst({
    where: { characterId: character.id, quantity: { gt: 0 }, tag: { slug } },
    select: { id: true },
  });
  if (held) return true;

  // Nowhere to stand is nowhere to reach from.
  if (!character.locationId) return false;

  const [rooms, keys, structures] = await Promise.all([
    prisma.room.findMany({
      where: { locationId: character.locationId, tags: { some: { quantity: { gt: 0 }, tag: { slug } } } },
      select: { id: true, kind: true, accessTagSlugs: true },
    }),
    roomAccessKeys(prisma, character.id),
    structuresAt(prisma, character.locationId, { statuses: ["COMPLETE"] }),
  ]);
  if (structures.some((s) => s.placement?.provides?.includes(slug))) return true;
  return accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length > 0;
}

module.exports = { hasEquipmentInReach };
