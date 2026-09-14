// Writing a corpse (docs/systemdocs/CORPSES.md). THIRD authoring door onto the
// tag catalog, but the row carries `custom: true` so sync/prune-tags skip it
// like homebrew; Tag.corpseOfCharacterId is what lets Restart Game delete just
// these. Takes `prisma`/tx as a parameter; stays off the @lifeweb/db barrel.
const { CORPSE_GROUP_SLUG, CORPSE_ROT_TURNS } = require("./constants");
const { pickRandomPublicRoom } = require("./roomStash");
const { addToRoomStack, addToStack } = require("./tagWrites");
const { expiryFrom } = require("./turnFormat");
const { corpseWeightFor } = require("./corpseWeight");

function corpseName(name) {
  return `${name}'s Corpse`;
}

function corpseDescription(name) {
  return `The lifeless body of ${name}.`;
}

// `custom-` prefix keeps this out of the YAML's namespace; `-corpse` suffix is inside it so "Corpse" still reads fine.
function corpseSlug(name, suffix = 0) {
  const base = (name ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `custom-${base || "unnamed"}-corpse${suffix ? `-${suffix}` : ""}`;
}

// Tag.slug is @unique; retries on violation rather than a pre-check, since two same-turn deaths could both pass one. "(2)" suffix disambiguates a GM's list, not a constraint.
async function createCorpseTag(tx, character, groupId, expiresTurn, weightLbs) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const suffixed = attempt ? `${corpseName(character.name)} (${attempt + 1})` : corpseName(character.name);
    try {
      return await tx.tag.create({
        data: {
          slug: corpseSlug(character.name, attempt),
          name: suffixed,
          description: corpseDescription(character.name),
          category: "items",
          groupId,
          pointCost: 0,
          custom: true,
          corpseKind: "FRESH",
          corpseOfCharacterId: character.id,
          inspectVisibility: "ALWAYS", // visibly hauling a body — docs/tags.yaml's `visible: true` case
          tradeable: true,
          stackable: false, // one body is one body
          weightLbs, // cargo (db/lib/corpseWeight.js): base weight bent by build, plus gear; recomputed when looted
          removable: false, // Butcher and Bury are the only two ways a body leaves the world
          consumable: false,
          purchasable: false,
          purchasableAfterStart: false,
          defaultDurationTurns: CORPSE_ROT_TURNS,
        },
      });
    } catch (err) {
      if (err?.code !== "P2002") throw err; // P2002 = @unique slug collision, someone shares this name
    }
  }
  return null;
}

// Mint the corpse and put it somewhere. `room` null = landed on the dead character's own sheet (not an error — corpseFollow reads that as already home). Idempotent via Tag.corpseOfCharacterId's @unique.
async function mintCorpse(tx, character, turn = null) {
  const existing = await tx.tag.findUnique({ where: { corpseOfCharacterId: character.id } });
  if (existing) return { tag: existing, room: null, alreadyExisted: true };

  const group = await tx.tagGroup.findUnique({ where: { slug: CORPSE_GROUP_SLUG }, select: { id: true } });
  // No group means db:sync-tags hasn't run. A missing corpse is bad; a death that throws is worse.
  if (!group) {
    console.error(`mintCorpse: no "${CORPSE_GROUP_SLUG}" tag group — run db:sync-tags.`);
    return { tag: null, room: null };
  }

  const expiresTurn = turn ? expiryFrom(turn.number + 1, CORPSE_ROT_TURNS) : null;
  // Read off the sheet, not the `character` handed in — callers pass varying selects.
  const weightLbs = (await corpseWeightFor(tx, character.id)) ?? undefined;
  const tag = await createCorpseTag(tx, character, group.id, expiresTurn, weightLbs);
  if (!tag) {
    console.error(`mintCorpse: could not find a free name for ${character.name}'s corpse.`);
    return { tag: null, room: null };
  }

  const room = await pickRandomPublicRoom(tx, character.locationId);
  if (room) {
    await addToRoomStack(tx, room.id, tag.id, 1, { expiresTurn });
  } else {
    await addToStack(tx, character.id, tag.id, 1, { source: "EVENT", expiresTurn, stackable: false });
  }
  return { tag, room };
}

// Used by a GM Revive. Holdings go FIRST — CharacterTag.tagId is RESTRICT (unlike RoomTag's cascade), so a carried corpse must be cleared first or deletion throws. NOT used by Butcher/Bury, which leave the Tag row so a GM's Undo can restore it (web/lib/tagEffects.js).
async function deleteCorpseFor(db, characterId) {
  const tag = await db.tag.findUnique({ where: { corpseOfCharacterId: characterId }, select: { id: true } });
  if (!tag) return false;
  await db.characterTag.deleteMany({ where: { tagId: tag.id } });
  await db.roomTag.deleteMany({ where: { tagId: tag.id } });
  await db.tag.delete({ where: { id: tag.id } });
  return true;
}

module.exports = {
  mintCorpse,
  deleteCorpseFor,
  corpseName,
};
