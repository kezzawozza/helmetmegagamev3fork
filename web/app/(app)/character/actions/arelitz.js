"use server";

// Breaking in an unruly arelitz (db/lib/arelitz.js — read its header first,
// and ARELITZ.md §6, the whole rulebook this action enforces). Modeled on
// farmRequestImpl (./soilery.js, the Location-gated-action shape) and
// healCharacterRequestImpl's Gambit branch (./medical.js — the die rolls
// immediately at filing) — but resolves at turn push
// (db/lib/moveEffects.js's `brokeIn` entry) instead of waiting on a GM,
// since a stable's worth of attempts can't sit in limbo.
import { prisma } from "@lifeweb/db";
import { UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { breakInRefusalFor } from "@lifeweb/db/lib/arelitz";
import { livestockInReach } from "@lifeweb/db/lib/corpses";
import { UNRULY_ARELITZ_SLUG } from "@lifeweb/db/lib/constants";
import { requireFreeMove } from "@/lib/moveSpend";
import { rollWithAdvantage } from "@lifeweb/db/lib/advantage";
import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import { consumeInspiredIfUsed, lockRoom } from "@lifeweb/db/lib/tagWrites";
import { logAudit } from "@/lib/requests";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { requireCharacter, revalidateAll, lockCharacter } from "./shared.js";

// Every unruly arelitz in reach — held, or stashed in a Room at this
// character's Location. Reuses livestockInReach's row shape (ARELITZ.md §5)
// rather than a second query; `sourceKey` is the same "kind:id" the dialog
// already knows how to post.
async function unrulyArelitzInReach(character) {
  const rows = await livestockInReach(prisma, character);
  return rows.filter((r) => r.tagSlug === UNRULY_ARELITZ_SLUG);
}

async function resolveUnrulyTarget(character, { tagId, sourceKey }) {
  const rows = await unrulyArelitzInReach(character);
  const found = rows.find((r) => r.tagId === tagId && r.sourceKey === sourceKey);
  if (!found) throw new UserError("That arelitz isn't there any more.");
  return found;
}

export async function breakInArelitzRequestImpl({ tagId, sourceKey }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // Standing on a `stable` Room — ARELITZ.md §3. Location-grain, same as
  // every other gated verb: a stable Room anywhere in this Location counts,
  // matching how Butcher/corpsesInReach read "reachable" at Location grain.
  const stable = character.locationId
    ? await prisma.room.findFirst({
        where: { locationId: character.locationId, stable: true },
        select: { id: true },
      })
    : null;
  if (!stable) throw new UserError("There's no stable here.");

  // arelitz-mastery held, and no action filed yet this turn — the same
  // function the sheet's own Break In tooltip reads (ARELITZ.md §6).
  const refusal = breakInRefusalFor(character.tags, false);
  if (refusal) throw new UserError(refusal);

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) {
    throw new UserError(`You're in no state to break in an animal — you're ${blocker.name}.`);
  }

  const target = await resolveUnrulyTarget(character, { tagId, sourceKey });

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);

  const breakInPlan = {
    v: 1,
    kind: target.source.kind,
    ...(target.source.kind === "character"
      ? { characterId: target.source.id }
      : { roomId: target.source.id }),
    tagId: target.tagId,
    tagName: target.tagName,
  };

  await prisma.$transaction(async (tx) => {
    // Lock order (character first, then room) matches medical.js's own
    // deadlock-avoidance rule for the same reason: this transaction can hold
    // both kinds of row.
    await lockCharacter(tx, character.id);
    if (target.source.kind === "room") await lockRoom(tx, target.source.id);

    // Re-checked under the lock — the dialog's list is advisory, same
    // posture as farmRequestImpl's sowing-ticket re-check.
    const still =
      target.source.kind === "character"
        ? await tx.characterTag.findUnique({
            where: { characterId_tagId: { characterId: target.source.id, tagId: target.tagId } },
            select: { quantity: true },
          })
        : await tx.roomTag.findUnique({
            where: { roomId_tagId: { roomId: target.source.id, tagId: target.tagId } },
            select: { quantity: true },
          });
    if (!still?.quantity) throw new UserError("That arelitz isn't there any more.");

    // Lucky or Inspired keeps the better of two dice; Inspired spends the
    // instant it wins one — same as a Heal Gambit.
    const advantage = rollWithAdvantage(character.tags, 6, { gambitOnly: true });
    await consumeInspiredIfUsed(tx, character.id, advantage.source);

    let action;
    try {
      action = await tx.action.create({
        data: {
          characterId: character.id,
          turnId: openTurn.id,
          type: "MOVE",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          moveKind: "GAMBIT",
          moveReviewStatus: "OPEN",
          description: `Breaking in ${target.tagName}.`,
          diceRoll: advantage.die,
          diceModifier: gambitModifierTotal(character.tags, { mood: character.mood }),
          zoneId: character.zoneId ?? null,
          locationId: character.locationId ?? null,
          gmNotes: "auto:break_arelitz",
          breakInPlan,
        },
      });
    } catch (err) {
      // @@unique([characterId, turnId]) rations two racing tabs to one Move a turn.
      if (err?.code === "P2002") throw new UserError("You've already used your Move this turn.");
      throw err;
    }

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_break_arelitz",
      targetCharacterId: character.id,
      turnId: openTurn.id,
      details: { breakInPlan, actionId: action.id },
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();

  return {
    line: "You start working the arelitz. You'll know how it went at the end of the turn.",
  };
}
