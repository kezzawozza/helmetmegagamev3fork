"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import {
  STOWABLE_SLUGS,
  WATER_TRAVEL_SLUGS,
  BOAT_CONFLICT_SLUGS,
  FAST_TRAVEL_SLUGS,
} from "@lifeweb/db/lib/mounts";
import { MOTION_SICKNESS_SLUG } from "@lifeweb/db/lib/constants";
import { parksMounts } from "@lifeweb/db/lib/locationAttributes";
import { HANDS_TAG_FIELDS, findEquipProblem, handsFor } from "@lifeweb/db/lib/equipSlots";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { auth } from "@/lib/auth";

// A refusal a human caused (no free slots, a clash), thrown inside the transaction to roll the write back and caught outside it for the player-facing sentence. Never crosses that boundary.
class EquipRefusalError extends Error {}

// Equipping writes no Request/AuditLog — costs nothing, undoable in one tap, and a row per toggle at 100+ players would drown /gm/audit (contrast TRANSFER_RESOURCES, REQUESTS.md). A slot holds one physical item: CharacterTag.equippedQuantity counts a stack's units out, each its own slot; equipOne/unequipOne move one at a time (db/lib/tagOps.js is the one bulk path, for the Dev Panel).

// Shared by both directions: resolved character plus the incapacitation gate blocking equip AND unequip alike. Never trusts a posted id.
async function resolveActor() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      location: { select: { indoors: true, attributes: true, name: true } },
      tags: { select: { equipped: true, tag: { select: { slug: true, name: true } } } }, // name is read by the boat/mount clash below
    },
  });
  if (!character) return { error: "No living character." };

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) {
    return { error: `You can't work your hands right now — you're ${blocker.name}.` };
  }
  return { character };
}

// Pulls one more unit out of a held stack and gives it its own slot. Equipping all 5 of a stack of 5 swords is five of these, not one call that equips the whole stack.
export async function equipOne(characterTagId) {
  const actor = await resolveActor();
  if (actor.error) return actor;
  const { character } = actor;

  const held = await prisma.characterTag.findFirst({
    where: { id: characterTagId ?? "", characterId: character.id },
    select: {
      id: true,
      quantity: true,
      equippedQuantity: true,
      tag: { select: { equippable: true, name: true, slug: true } },
    },
  });
  if (!held) return { error: "You aren't holding that." };
  if (!held.tag.equippable) return { error: `${held.tag.name} isn't something you can equip.` };
  if (held.equippedQuantity >= held.quantity) {
    return { error: `You don't have another ${held.tag.name} to equip.` };
  }

  // The gates below only fire on the FIRST unit out — none of these slugs is stackable.
  const firstUnitOut = held.equippedQuantity === 0;

  // A cart doesn't come into a chapel (CARRY.md §3) — `parksMounts`, not `indoors`. Gates equip only; incapacitation above runs both ways.
  if (firstUnitOut && STOWABLE_SLUGS.has(held.tag.slug) && parksMounts(character.location)) {
    return { error: `You can't set up ${held.tag.name} inside ${character.location.name}.` };
  }

  // Motion Sickness: gated here only, on equipping yourself. A dragged passenger with no mount of their own is db/lib/locationTravel.js's job.
  if (
    firstUnitOut &&
    (FAST_TRAVEL_SLUGS.has(held.tag.slug) || WATER_TRAVEL_SLUGS.has(held.tag.slug)) &&
    character.tags.some((ct) => ct.tag.slug === MOTION_SICKNESS_SLUG)
  ) {
    return { error: `Your stomach won't have it — you can't ride ${held.tag.name}.` };
  }

  // Riding or poling, not both — boat and road kit compete for the same free crossing. Checked in both directions.
  if (firstUnitOut) {
    const conflicting = WATER_TRAVEL_SLUGS.has(held.tag.slug)
      ? BOAT_CONFLICT_SLUGS
      : BOAT_CONFLICT_SLUGS.has(held.tag.slug)
        ? WATER_TRAVEL_SLUGS
        : null;
    if (conflicting) {
      const other = character.tags.find((ct) => ct.equipped && conflicting.has(ct.tag.slug));
      if (other) {
        return {
          error: `Put ${other.tag.name} away first — you can't have that and ${held.tag.name} out at once.`,
        };
      }
    }
  }

  // Counting inside the transaction alone isn't enough: Prisma runs at READ COMMITTED, so two tabs could both read the same worn set and both write. The Character row lock serializes every equip for this character.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${character.id} FOR UPDATE`;
      await tx.characterTag.update({
        where: { id: held.id },
        data: { equippedQuantity: { increment: 1 }, equipped: true },
      });

      const worn = await tx.characterTag.findMany({
        where: { characterId: character.id, equippedQuantity: { gt: 0 } },
        select: {
          equippedQuantity: true,
          tag: { select: { name: true, equipSlot: true, equipLayer: true, twoHanded: true } },
        },
      });
      // The player's own toggle REFUSES rather than sheds — only an involuntary change sheds (db/lib/tagOps.js). Hands come from everything HELD (a maiming is never equipped); named `holdings` because `held` shadows the row bound above.
      const holdings = await tx.characterTag.findMany({
        where: { characterId: character.id, quantity: { gt: 0 } },
        select: { tag: { select: HANDS_TAG_FIELDS } },
      });
      const problem = findEquipProblem(worn, handsFor(holdings));
      if (problem) throw new EquipRefusalError(problem);
    });
  } catch (err) {
    if (err instanceof EquipRefusalError) return { error: err.message };
    throw err;
  }

  // Equipping a Cart raises the cap, which can clear Overburdened.
  await afterInventoryChange([character.id]);
  revalidatePath("/character");
  return { equipped: true };
}

// Puts one unit back — the last one out also clears `equipped`.
export async function unequipOne(characterTagId) {
  const actor = await resolveActor();
  if (actor.error) return actor;
  const { character } = actor;

  const held = await prisma.characterTag.findFirst({
    where: { id: characterTagId ?? "", characterId: character.id },
    select: { id: true, equippedQuantity: true, tag: { select: { name: true } } },
  });
  if (!held) return { error: "You aren't holding that." };
  if (held.equippedQuantity <= 0) return { error: `${held.tag.name} isn't equipped.` };

  const equippedQuantity = held.equippedQuantity - 1;
  await prisma.characterTag.update({
    where: { id: held.id },
    data: { equippedQuantity, equipped: equippedQuantity > 0 },
  });
  // Unequipping a Cart shrinks the carry cap; Overburdened goes on but nothing is dropped for a shrink (CARRY.md §1).
  await afterInventoryChange([character.id]);
  revalidatePath("/character");
  return { equipped: equippedQuantity > 0 };
}

// Take from a room stash and put it on in one gesture (EquipBoard.js). TWO ACTS, deliberately not merged: the take goes through the ordinary transferRequest (re-resolves actor, re-checks reach) so it costs what reaching in from the dialog costs. If the wear half refuses, THE TAKE STILL STANDS — it's in your pack rather than an unwound transfer.
export async function takeAndEquip({ roomId, tagId }) {
  const actor = await resolveActor();
  if (actor.error) return actor;
  const { character } = actor;
  if (!roomId || !tagId) return { error: "Nothing to take." };

  const { transferRequest } = await import("./requestActions");
  const took = await transferRequest({
    fromKey: `room:${roomId}`,
    toKey: `character:${character.id}`,
    tags: [{ tagId: String(tagId), quantity: 1 }],
    amount: 0,
  });
  if (took?.error) return { error: took.error };

  // Found by tag, not the transfer's returned id — a part-held stack merges into the existing row instead of creating one.
  const held = await prisma.characterTag.findFirst({
    where: { characterId: character.id, tagId: String(tagId) },
    select: { id: true },
  });
  if (!held) return { error: "You took it, but it isn't on your sheet. Tell a GM." };

  const wore = await equipOne(held.id);
  if (wore?.error) {
    return { error: `${wore.error} It is in your pack.` };
  }
  return wore;
}
