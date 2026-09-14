import { bumpBlood, bumpAccount, OBOL_SLUG } from "@lifeweb/db";
import { addToStack, dropCharacterTag, grantTagSlugs, addToRoomStack, dropRoomTag } from "@lifeweb/db/lib/tagWrites";
import { moveParty, InsufficientResourcesError } from "@lifeweb/db/lib/resourceTransfer";
import { INDESTRUCTIBLE_SLUGS } from "@lifeweb/db/lib/nuke";
import { UserError } from "@/lib/actionResult";

// The shared write primitives every player action and GM microaction moves tags and ⬢ through. Every function below runs INSIDE a prisma transaction.

// --- shared primitives ------------------------------------------------

// Moves a party's balance by a signed delta and REFUSES rather than going negative — the write IS the check.
export async function moveResources(tx, party, delta, ctx) {
  try {
    await moveParty(tx, party, delta, ctx);
  } catch (err) {
    if (!(err instanceof InsufficientResourcesError)) throw err;
    if (party?.kind === "room") throw new UserError(`${party.name ?? "That room"} no longer holds ${err.amount} ⬢.`);
    throw new UserError(`${party?.name ?? "That character"} no longer has ${err.amount} ⬢.`);
  }
}

// `ctx` is threaded through to moveParty, which records the ledger row.
export async function creditResources(tx, party, amount, ctx) {
  if (!party || !amount) return;
  await moveResources(tx, party, amount, ctx);
}

export async function debitResources(tx, party, amount, ctx) {
  if (!party || !amount) return;
  await moveResources(tx, party, -amount, ctx);
}

async function moveBlood(tx, delta) {
  if (!delta) return;
  await bumpBlood(tx, delta);
}

// --- stacks: a stackable tag is ONE CharacterTag row carrying a count, never N rows. -----------------

export { addToStack };

// Restores a CharacterTag from a snapshot. Upserts (the player may have re-acquired it elsewhere); the
// update branch INCREMENTS. `poisonedCount`/`poisonPayload` (M4) dilute clean on merge, same "poisons don't mix" rule addToStack enforces.
export async function restoreCharacterTag(tx, characterId, snapshot) {
  const n = Math.max(1, Math.trunc(snapshot.quantity ?? 1));
  const incomingPoisoned =
    snapshot.poisonedCount > 0 ? Math.min(Math.trunc(snapshot.poisonedCount), n) : 0;
  const incomingPayload = snapshot.poisonPayload ?? null;
  const existing = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId, tagId: snapshot.tagId } },
  });
  if (existing) {
    const samePoison =
      !existing.poisonPayload || !incomingPayload || existing.poisonPayload === incomingPayload;
    return tx.characterTag.update({
      where: { id: existing.id },
      data: {
        quantity: existing.quantity + n,
        expiresTurn: snapshot.expiresTurn ?? null,
        poisonedCount: samePoison ? existing.poisonedCount + incomingPoisoned : existing.poisonedCount,
        poisonPayload: existing.poisonPayload ?? (samePoison ? incomingPayload : null),
      },
    });
  }
  return tx.characterTag.create({
    data: {
      characterId,
      tagId: snapshot.tagId,
      source: snapshot.source ?? "GM_GRANT",
      expiresTurn: snapshot.expiresTurn ?? null,
      quantity: n,
      poisonedCount: incomingPoisoned,
      poisonPayload: incomingPoisoned > 0 ? incomingPayload : null,
    },
  });
}

export { dropCharacterTag };
export { grantTagSlugs };
export { addToRoomStack, dropRoomTag };

// --- party-shaped tag moves: a TRANSFER_TAG end is a character or a Room stash (CARRY.md) ------------

// Takes `quantity` of a tag off a party; a room's decrement is the check. Returns `{ poisonedTaken, poisonPayload }` (M4) for `giveTagTo`.
export async function takeTagFrom(tx, party, tagId, quantity) {
  if (!party?.id || !tagId) return { poisonedTaken: 0, poisonPayload: null };
  if (party.kind === "room") {
    const { ok, poisonedTaken, poisonPayload } = await dropRoomTag(tx, party.id, tagId, quantity);
    if (!ok) throw new UserError(`${party.name ?? "That room"} no longer holds that.`);
    return { poisonedTaken, poisonPayload };
  }
  return dropCharacterTag(tx, party.id, tagId, quantity);
}

// Puts a snapshot back on a party; both branches INCREMENT and re-assert the snapshot's clock.
export async function giveTagTo(tx, party, snapshot) {
  if (!party?.id || !snapshot?.tagId) return;
  if (party.kind === "room") {
    // The Spillway: nothing written, nothing fished back out — except what the trough cannot eat.
    if (party.destroysContents) {
      const tag = await tx.tag.findUnique({
        where: { id: snapshot.tagId },
        select: { slug: true },
      });
      if (!INDESTRUCTIBLE_SLUGS.has(tag?.slug)) return;
    }
    await addToRoomStack(tx, party.id, snapshot.tagId, snapshot.quantity ?? 1, {
      expiresTurn: snapshot.expiresTurn ?? null,
      poisonedCount: snapshot.poisonedCount ?? 0,
      poisonPayload: snapshot.poisonPayload ?? null,
    });
    return;
  }
  await restoreCharacterTag(tx, party.id, snapshot);
}


