// Corpses: what one is, who it belongs to, what comes out of it.
// docs/systemdocs/CORPSES.md owns the design; this is the shared vocabulary.
// A corpse is a HANDLE to a dead character's sheet, not a container — goods
// stay on the Character row, LOOT_CHARACTER is untouched, but
// db/lib/corpseFollow.js walks the dead sheet after its corpse, so carrying
// a body somewhere makes it lootable there. Lives in db/ because both faces
// read it. Takes `prisma` as a parameter; stays off the @lifeweb/db barrel,
// require it by path. The three pure exports at the top have no prisma ON
// PURPOSE — the Butcher dialog is a client component needing MONSTER_YIELDS,
// and importing anything prisma-shaped there kills the route with a node:fs error.
const { CORPSE_GROUP_SLUG, HUMAN_FLESH_SLUG } = require("./constants");
const { accessibleRooms, roomAccessKeys } = require("./roomAccess");

// Anything not one of these three is a person's and yields Human Flesh — keyed on "not a listed
// monster", not the character link, so a corpse whose Character row is gone still butchers into something.
const MONSTER_YIELDS = {
  "nekker-corpse": "nekker-pheromones",
  "graga-corpse": "graga-sac",
  "skinless-corpse": "skinless-brain",
};

// The group IS the discriminator: Tag.corpseKind is set differently by sync vs death path, but a
// client component only ever sees the group.
function isCorpseTag(tag) {
  return tag?.group?.slug === CORPSE_GROUP_SLUG;
}

function yieldSlugFor(tag) {
  return MONSTER_YIELDS[tag?.slug] ?? HUMAN_FLESH_SLUG;
}

// A person's corpse. The FK is the truth here — the name is prose and the rot rename rewrites it.
function isHumanCorpse(tag) {
  return Boolean(tag?.corpseOfCharacterId);
}

// Exported so the page, server actions and room readout can't drift into
// asking for different columns — a missing `group` silently makes isCorpseTag() false everywhere.
const CORPSE_TAG_FIELDS = {
  id: true,
  slug: true,
  name: true,
  description: true,
  corpseKind: true,
  corpseOfCharacterId: true,
  stackable: true,
  group: { select: { slug: true } },
  corpseOf: { select: { id: true, name: true, discordUserId: true } }, // null on a monster corpse
};

// One function, called by the page to build the menu AND by both server
// actions to re-check it, so the dialog and the gate can never disagree —
// same posture as transferRequest (CARRY.md §6).
async function corpsesInReach(prisma, character, { rooms = null } = {}) {
  if (!character?.locationId) return [];

  const held = await prisma.characterTag.findMany({
    where: { characterId: character.id, tag: { group: { slug: CORPSE_GROUP_SLUG } } },
    select: { quantity: true, tag: { select: CORPSE_TAG_FIELDS } },
  });

  // Re-derive only when the caller lacks the filtered room list, so /character avoids a second round-trip.
  let reachable = rooms;
  if (!reachable) {
    const all = await prisma.room.findMany({
      where: { locationId: character.locationId },
      select: { id: true, name: true, kind: true, accessTagSlugs: true, discordThreadId: true },
    });
    const { heldSlugs, guestRoomIds } = await roomAccessKeys(prisma, character.id);
    reachable = accessibleRooms(all, heldSlugs, guestRoomIds);
  }

  const roomIds = reachable.map((r) => r.id);
  const stashed = roomIds.length
    ? await prisma.roomTag.findMany({
        where: { roomId: { in: roomIds }, tag: { group: { slug: CORPSE_GROUP_SLUG } } },
        select: { roomId: true, quantity: true, tag: { select: CORPSE_TAG_FIELDS } },
      })
    : [];
  const roomById = new Map(reachable.map((r) => [r.id, r]));

  const row = (tag, source, quantity) => ({
    tagId: tag.id,
    tagSlug: tag.slug,
    tagName: tag.name,
    quantity: quantity ?? 1,
    rotten: tag.corpseKind === "ROTTEN",
    human: isHumanCorpse(tag),
    deadCharacterId: tag.corpseOfCharacterId ?? null,
    deadName: tag.corpseOf?.name ?? null,
    yieldSlug: yieldSlugFor(tag),
    source,
    sourceKey: `${source.kind}:${source.id}`,
  });

  return [
    ...held.map((ct) =>
      row(ct.tag, { kind: "character", id: character.id, name: "You" }, ct.quantity),
    ),
    // discordThreadId rides along so a caller can hand the source straight to roomAnnounce.js#announceInRoom.
    ...stashed.map((rt) =>
      row(
        rt.tag,
        {
          kind: "room",
          id: rt.roomId,
          name: roomById.get(rt.roomId)?.name ?? "a room",
          discordThreadId: roomById.get(rt.roomId)?.discordThreadId ?? null,
        },
        rt.quantity,
      ),
    ),
  ];
}

module.exports = {
  isCorpseTag,
  corpsesInReach,
};
