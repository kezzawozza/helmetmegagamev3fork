// The DATABASE half of a character's death — shared so the two death paths
// (web/lib/discordGuild.js#killCharacter and db/lib/catatonicDeathPass.js)
// can't drift; each keeps its own Discord half, but what death *means* on the
// row is decided here, once. Takes `prisma` as the first parameter;
// deliberately NOT on the @lifeweb/db barrel, require it by path.
const { recordArchiveEvent } = require("./archive");
const { mintCorpse } = require("./corpseMint");
const { cancelOffersForCharacter } = require("./lessons");
const { SEAT_TAG_SLUGS } = require("./threats");
const { applyMood } = require("./mood");
const { GIBBED_SLUG, METEMPSYCHOSIS_SLUG, HEIGHTENED_PSYCHOSIS_SLUG } = require("./constants");
const { NOT_A_FIGHT } = require("./intercept");
const { closeFightsFor } = require("./attack");
const { teardownPartyThread } = require("./partyChat");
const { CONCEALMENT_TAG_FIELDS, concealmentFrom } = require("./presentedIdentity");

// The concealing piece this character is wearing RIGHT NOW, or null — read off
// the database rather than off `character`, since callers pass varying shapes
// and the claim below is about to unequip everything.
//
// It has to happen before the unequip, because concealment only ever counts an
// EQUIPPED mask: without this, dying took your hood off, and a masked body was
// named in the room's Loot menu a moment after it hit the floor. Only a hood
// that was actually IN EFFECT is remembered — the same `forced || concealed`
// rule the living are judged by (db/lib/whosHere.js#presentRows), so a helmet
// worn with the toggle off stays what it was, a helmet.
async function maskWornNow(prisma, characterId) {
  const row = await prisma.character
    .findUnique({
      where: { id: characterId },
      select: {
        concealed: true,
        tags: {
          where: { equipped: true, tag: { concealsIdentity: true } },
          select: { tagId: true, equipped: true, tag: { select: CONCEALMENT_TAG_FIELDS } },
        },
      },
    })
    .catch(() => null);
  if (!row) return null;
  const piece = concealmentFrom(row.tags);
  if (!piece || !(piece.forced || row.concealed)) return null;
  return piece.tagId ?? null;
}

// Marks one character DEAD. Returns { claimed } — false when no longer ALIVE,
// in which case NOTHING else is written: the update's `status: "ALIVE"`
// where-clause IS the claim, so racing callers can never half-kill or
// double-archive. `expectStatus` is for the web path, which calls this a
// moment AFTER updateCharacterRaw already wrote DEAD. discordRoleId is nulled
// here, so the caller must capture it FIRST — it still owes Discord the role
// delete. `gib` is the vaporised variant — no corpse, every tag replaced by
// one "Gibbed" row (vaporizeTags, CORPSES.md §1a). Returns
// `corpse: { tag, room }` alongside `claimed`; `room` null means it stayed on
// the sheet for want of a public room.
// Vaporised rather than killed: every tag deleted, one "Gibbed" row replaces
// them, no corpse minted. Called with `gib: true` from the two Thanati rites
// and the bomb. SEAT_TAG_SLUGS is the one load-bearing exception: the
// end-of-game reveal reads antagonist seats off live Character rows
// (db/lib/epilogue.js), and the bomb gibs everyone then ends the game.
async function vaporizeTags(prisma, characterId) {
  await prisma.characterTag.deleteMany({
    where: { characterId, tag: { slug: { notIn: SEAT_TAG_SLUGS } } },
  });

  const gibbed = await prisma.tag.findUnique({ where: { slug: GIBBED_SLUG }, select: { id: true } });
  if (!gibbed) {
    console.error(`No "${GIBBED_SLUG}" tag to stamp on ${characterId} — run npm run db:sync-tags.`);
    return;
  }
  await prisma.characterTag.create({ data: { characterId, tagId: gibbed.id, source: "EVENT" } });
}

async function applyDeathToRow(prisma, character, { turn = null, content = null, expectStatus = "ALIVE", gib = false } = {}) {
  // Read BEFORE the claim, off the database not `character` (callers pass varying shapes, and a
  // gib deletes the rows outright below).
  const reborn = await prisma.characterTag
    .count({ where: { characterId: character.id, tag: { slug: METEMPSYCHOSIS_SLUG } } })
    .catch(() => 0);
  // Same reason, same timing: how many lives this soul has already spent, off
  // the dying character's own stack — a gib would otherwise erase the count
  // it is about to carry forward.
  const priorPsychosis = reborn
    ? await prisma.characterTag
        .findFirst({
          where: { characterId: character.id, tag: { slug: HEIGHTENED_PSYCHOSIS_SLUG } },
          select: { quantity: true },
        })
        .catch(() => null)
    : null;

  // Same reason, same moment: what is over the face has to be read before the
  // unequip below takes it off. A gib keeps none of it — vaporizeTags deletes
  // the row, so there is nothing left for a face to be derived from.
  const deathMaskTagId = gib ? null : await maskWornNow(prisma, character.id);

  const claimed = await prisma.character.updateMany({
    where: { id: character.id, status: expectStatus },
    data: {
      status: "DEAD",
      discordRoleId: null,
      catatonicSinceTurn: null,
      deathMaskTagId,
    },
  });
  if (claimed.count === 0) return { claimed: false };

  // A gib deletes the tags outright; an ordinary death only drops them out of their slots.
  if (gib) {
    await vaporizeTags(prisma, character.id).catch((err) =>
      console.error(`Failed to vaporize tags for ${character.id}:`, err),
    );
  } else {
    await prisma.characterTag
      .updateMany({
        where: { characterId: character.id, equipped: true },
        data: { equipped: false, equippedQuantity: 0 },
      })
      .catch((err) => console.error(`Failed to unequip on death for ${character.id}:`, err));
  }

  // A dead leader leads nobody; everyone following them lets go. NOT cleared: `escortedById` on
  // this row — a corpse can still be carried (db/lib/escort.js gives a body FORCED).
  await prisma.character
    .updateMany({
      where: { escortedById: character.id },
      data: { escortedById: null },
    })
    .catch((err) => console.error(`Failed to release the party on death for ${character.id}:`, err));

  // The party chat (db/lib/partyChat.js) is keyed on this character as its
  // creator. Death dissolves the party, so the thread and the row go with it.
  await teardownPartyThread(prisma, character.id).catch((err) =>
    console.error(`Failed to tear down party thread on death for ${character.id}:`, err),
  );

  // A dead man holds nobody (INTERCEPT.md). Their OWN heldUntil is left alone — costs a corpse
  // nothing and lapses on its own. A FIGHT comes off first, through the row not heldById
  // (ATTACK.md §2): both attacker and target release, or settleHold would keep pinning the survivor.
  await closeFightsFor(prisma, character.id).catch((err) =>
    console.error(`Failed to close fights on death for ${character.id}:`, err),
  );
  // Guarded away from a fight (like releaseHeldBy): heldById names one opponent but a brawl has several.
  await prisma.character
    .updateMany({
      where: { heldById: character.id, ...NOT_A_FIGHT },
      data: { heldUntil: null, heldById: null, heldReason: null },
    })
    .catch((err) => console.error(`Failed to release held characters on death for ${character.id}:`, err));
  await prisma.character
    .update({
      where: { id: character.id },
      data: { escortConsentToId: null, escortConsentUntilTurn: null },
    })
    .catch((err) => console.error(`Failed to clear escort consent on death for ${character.id}:`, err));

  // A pending handshake is void either way (LESSONS.md, CRAFTING.md); an ACCEPTED lesson still resolves.
  await cancelOffersForCharacter(prisma, character.id).catch((err) =>
    console.error(`Failed to void offers on death for ${character.id}:`, err),
  );
  await prisma.craftProject
    .updateMany({ where: { characterId: character.id, status: "ACTIVE" }, data: { status: "CANCELLED" } })
    .catch((err) => console.error(`Failed to cancel craft projects on death for ${character.id}:`, err));

  // One Tag row in a random public Room (CORPSES.md) — a HANDLE to this sheet, so the sheet
  // follows the tag. Wrapped: a missing corpse is recoverable by hand, a half-applied death isn't.
  const corpse = gib
    ? { tag: null, room: null }
    : await mintCorpse(prisma, character, turn).catch((err) => {
        console.error(`Failed to mint a corpse for ${character.id}:`, err);
        return { tag: null, room: null };
      });

  // Everyone standing where they fell saw it (MOOD.md). Re-read, not trusted off `character`;
  // wrapped so a death is never aborted by a witness's nerves.
  await frightenWitnesses(prisma, character.id).catch((err) =>
    console.error(`Failed to frighten witnesses of ${character.id}:`, err.message ?? err),
  );

  // recordArchiveEvent already swallows its own failures, so no catch here.
  await recordArchiveEvent(prisma, {
    kind: "DEATH",
    character,
    turn,
    zoneId: character.zoneId ?? null,
    content: content ?? `${character.name} died.`,
  });

  // The soul doesn't wait for a body (db/lib/reincarnate.js). Wrapped: a failed rebirth must not
  // leave the old life half-buried; null is ordinary when no seat is free.
  if (reborn > 0) {
    // Required HERE not at the top: reincarnate -> locationMove -> ... loops back to this file,
    // and a top-level require would resolve to a half-built exports object.
    const { reincarnate } = require("./reincarnate");
    await reincarnate(prisma, character, { turn, priorPsychosisCount: priorPsychosis?.quantity ?? 0 }).catch(
      (err) => console.error(`Reincarnation failed for ${character.id}:`, err.message ?? err),
    );
  }

  return { claimed: true, corpse };
}

async function frightenWitnesses(prisma, deadCharacterId) {
  const dead = await prisma.character.findUnique({ where: { id: deadCharacterId }, select: { locationId: true } });
  if (!dead?.locationId) return;
  const witnesses = await prisma.character.findMany({
    where: { locationId: dead.locationId, status: "ALIVE", id: { not: deadCharacterId } },
    select: { id: true },
  });
  // Sequential: a burst of parallel transactions at turn close competes for pool slots.
  for (const { id } of witnesses) {
    await applyMood(prisma, id, { kind: "DEATH_SEEN" }).catch((err) =>
      console.error(`Death-seen mood failed for ${id}:`, err.message ?? err),
    );
  }
}

module.exports = { applyDeathToRow };
