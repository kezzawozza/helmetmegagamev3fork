"use server";

// The Mine button (db/lib/mining.js — read its header first, it's the whole rulebook this
// action enforces). Modelled on ./soilery.js, but with one difference that matters: Mine is
// paid AT THE PRESS, not at the turn push — a day in the seam is a roll against a range, not a
// judgement anybody makes, so there is nothing for a GM to arbitrate and nothing worth making
// the player wait for.
import { prisma } from "@lifeweb/db";
import { UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import {
  resolveMiningRate,
  lazyYield,
  lazyExpression,
  formatMiningBonusNote,
} from "@lifeweb/db/lib/mining";
import { rollResourceRange } from "@lifeweb/db/lib/resourceDelta";
import { applyMoveEffects } from "@lifeweb/db/lib/moveEffects";
import { AUTO_MINE_NOTE } from "@lifeweb/db/lib/constants";
import { requireFreeMove } from "@/lib/moveSpend";
import { logAudit } from "@/lib/requests";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { requireCharacter, revalidateAll, lockCharacter } from "./shared.js";

export async function mineRequestImpl() {
  const { session, character } = await requireCharacter();

  // The LocationMining row IS the gate — no row means you cannot dig here at all — and the
  // Exhausted lockout and the Prospecting skill are checked in the same call, so the refusal
  // the button's tooltip shows and the one a bypassed request hits can never drift apart.
  const rate = await resolveMiningRate(prisma, character.id);
  if (!rate.ok) throw new UserError(rate.reason);

  // Bound, Dying, Paralyzed, Catatonic. computeMiningAccess already refuses these, but the
  // sentence it gives is deliberately vague ("You can't work"); this one names the reason.
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) {
    throw new UserError(`You're in no state to work — you're ${blocker.name}.`);
  }

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);

  // Lazy takes its quarter AFTER the roll, not off the range. The stored expression is cut the
  // same way so the sheet and the GM desk print the range the payout is actually inside.
  const heldSlugs = new Set((character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
  const roll = rollResourceRange(rate.expression);
  const value = lazyYield(roll?.value ?? 0, heldSlugs);
  const expression = lazyExpression(rate.expression, heldSlugs);

  let applied = null;
  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);

    // fileAutoRoutine's shape, written out because Mine carries a payout with it. The P2002
    // catch is the real gate (@@unique([characterId, turnId])) — two tabs can race
    // requireFreeMove.
    let action;
    try {
      action = await tx.action.create({
        data: {
          characterId: character.id,
          turnId: openTurn.id,
          type: "MOVE",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          moveKind: "ROUTINE",
          moveReviewStatus: "PASSED",
          description: "Working a seam.",
          resourceDelta: value,
          resourceRollExpression: expression,
          resourceRollValue: value,
          zoneId: character.zoneId ?? null,
          locationId: character.locationId ?? null,
          gmNotes: AUTO_MINE_NOTE,
        },
      });
    } catch (err) {
      if (err?.code === "P2002") throw new UserError("You've already used your Move this turn.");
      throw err;
    }

    // Pays now: the ⬢, the drop die, and the step up the fatigue ladder. Stamping
    // `appliedEffects` is what tells the turn-end push to skip this row (db/lib/stagedPush.js),
    // so the two can never both pay.
    applied = await applyMoveEffects(tx, action);
    await tx.action.update({ where: { id: action.id }, data: { appliedEffects: applied } });

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_mine",
      targetCharacterId: character.id,
      turnId: openTurn.id,
      details: {
        actionId: action.id,
        value,
        expression,
        coefficient: rate.locationCoefficient,
      },
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();

  // The range has the tools baked in, so somebody working with a pick is still told their kit
  // did something.
  const note = formatMiningBonusNote(rate);
  const drop = applied?.miningDrop;
  return {
    line: [
      `You worked the seam, producing ${value} ⬢.`,
      drop?.kind === "TAG" ? `You turned up ${drop.tagName}.` : null,
      note,
    ]
      .filter(Boolean)
      .join(" "),
  };
}
