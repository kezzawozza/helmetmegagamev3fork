// Spending a whole Move from a button (ADJUDICATION.md §2): one Action per character per turn.
// Crafting instead takes requestActions.js's resolveCraftMove, since a craft may cost a FRACTION
// of the Move and share the rest with another craft (FACTORY.md §3).
import { prisma } from "@lifeweb/db";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";
import { UserError } from "@/lib/actionResult";

export async function requireFreeMove(character, openTurn) {
  if (!openTurn) throw new UserError("No turn is open.");
  const { locked } = moveWindow(openTurn, { clockFrozen: await clockFrozen(prisma) });
  if (locked) throw new UserError("Moves are locked for this turn.");
  const acted = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true },
  });
  if (acted) throw new UserError("You've already used your Move this turn.");
}

// A Move the player never wrote: filed for them, already PASSED. `gmNotes` names the caller.
// The P2002 catch is the real gate (@@unique([characterId, turnId])) — two tabs can race requireFreeMove().
export async function fileAutoRoutine(
  tx,
  character,
  openTurn,
  description,
  gmNotes,
  craftBudget = null,
) {
  try {
    return await tx.action.create({
      data: {
        ...(craftBudget ? { craftBudget } : {}),
        characterId: character.id,
        turnId: openTurn.id,
        type: "MOVE",
        status: "CONFIRMED",
        confirmedAt: new Date(),
        moveKind: "ROUTINE",
        moveReviewStatus: "PASSED",
        description,
        appliedEffects: {},
        zoneId: character.zoneId ?? null,
        locationId: character.locationId ?? null,
        gmNotes,
      },
    });
  } catch (err) {
    if (err?.code === "P2002")
      throw new UserError("You've already used your Move this turn.");
    throw err;
  }
}
