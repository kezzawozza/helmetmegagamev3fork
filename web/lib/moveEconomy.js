// No `turnsRemaining` column: giving a turn back means DELETING the Action row. Shared so the Dev Panel and the Moves panel's Reject never drift.
import { revertMoveEffects } from "@lifeweb/db";
import { cancelOffersForAction } from "@lifeweb/db/lib/lessons";
import { travelClaimsToUndo } from "@lifeweb/db/lib/locationTravel";

export const MOVE_LOCK_TTL_MS = 90_000;

export function lockIsLive(action, now = new Date()) {
  return Boolean(action.lockExpiresAt && action.lockExpiresAt > now);
}

export async function findOpenTurnAction(prisma, characterId) {
  const openTurn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, phase: true },
  });
  if (!openTurn) return { openTurn: null, action: null };

  const action = await prisma.action.findFirst({
    where: { characterId, turnId: openTurn.id },
    include: { character: true },
  });
  return { openTurn, action };
}

// A Routine's resources land the moment the player confirms (ADJUDICATION.md §5), so deleting
// without reverting would leave ⬢ behind.
async function undoTravelClaims(tx, action) {
  const data = travelClaimsToUndo(action);
  if (data) await tx.character.update({ where: { id: action.characterId }, data });
}

// Takes a transaction client: both callers pair this with an audit write that must not commit separately.
export async function deleteActionRestoringTurn(tx, action) {
  const dms = await cancelOffersForAction(tx, action.id);
  if (action.appliedEffects) await revertMoveEffects(tx, action);
  await undoTravelClaims(tx, action);
  await tx.action.deleteMany({ where: { id: action.id } });
  return dms;
}
