// The dead sheet follows its corpse (CORPSES.md). Wherever the tag ends up —
// a Room's stash, a pocket — the dead character's locationId/zoneId move to
// match, so db/lib/presence.js#isHere makes the body lootable with no edit to
// lootCharacterRequestImpl, and Move/Harm come along free. PULL-BASED, and
// has to be: the case this exists for (picking a body up and WALKING) writes
// no tag at all, only the carrier's locationId changes — so this recomputes
// from current state (same reasoning as settleCarry and
// roomAccess.js#syncCharacterRoomAccess). POST-COMMIT, never inside a
// caller's transaction: runs beside settleCarry, which talks to Discord.
// Takes `prisma` as a parameter (db/lib/dm.js convention); off the barrel.

// Precedence: 1. in hands -> holder's Location, 2. in a Room -> Room's
// Location, 3. nowhere -> leave the dead row as-is. 1 beats 2 since a tag can
// briefly be both mid-transfer. "Nowhere" (buried/butchered) must never read
// as "move to null" — that would unplace every buried character.
async function placementFor(prisma, tag) {
  const held = await prisma.characterTag.findFirst({
    where: { tagId: tag.id },
    select: { character: { select: { id: true, locationId: true, zoneId: true } } },
  });
  if (held?.character?.locationId) {
    // A corpse on its OWN sheet is the no-public-room fallback from mintCorpse — already where it belongs.
    return { locationId: held.character.locationId, zoneId: held.character.zoneId };
  }
  const stashed = await prisma.roomTag.findFirst({
    where: { tagId: tag.id },
    select: { room: { select: { locationId: true, location: { select: { zoneId: true } } } } },
  });
  if (stashed?.room?.locationId) {
    return { locationId: stashed.room.locationId, zoneId: stashed.room.location?.zoneId ?? null };
  }
  return null;
}

// Cheap enough to call on any path that might have moved a corpse; a no-op when nothing did.
async function reconcileCorpse(prisma, tag) {
  if (!tag?.corpseOfCharacterId) return null;
  const where = await placementFor(prisma, tag);
  if (!where) return null;

  // Only ever moves a DEAD, unburied sheet. Revive clears the corpse tag, but the guard is here
  // too — teleporting a living character via their old body would be a confusing bug to chase.
  const moved = await prisma.character.updateMany({
    where: {
      id: tag.corpseOfCharacterId,
      status: "DEAD",
      buriedAt: null,
      NOT: { locationId: where.locationId },
    },
    data: { locationId: where.locationId, zoneId: where.zoneId },
  });
  return moved.count > 0 ? { characterId: tag.corpseOfCharacterId, ...where } : null;
}

// Takes no arguments: callers know a corpse MIGHT have moved but not which, and the scan is
// bounded by the number of deaths in the game.
async function reconcileCorpses(prisma) {
  const corpses = await prisma.tag.findMany({
    where: { corpseOfCharacterId: { not: null }, corpseOf: { status: "DEAD", buriedAt: null } },
    select: { id: true, corpseOfCharacterId: true },
  });
  const moved = [];
  for (const tag of corpses) {
    const result = await reconcileCorpse(prisma, tag).catch((err) => {
      console.error(`corpseFollow: failed to reconcile tag ${tag.id}:`, err);
      return null;
    });
    if (result) moved.push(result);
  }
  return moved;
}

module.exports = {
  reconcileCorpses,
};
