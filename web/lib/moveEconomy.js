// The turn economy. No `turnsRemaining` column: "has this character acted" is entirely "does an
// Action row exist for (characterId, the open Turn)" — which is why giving a turn back means
// DELETING a row, not flipping a flag. Shared by the Dev Panel's Restore-turn button and the Moves
// panel's Reject (extracted from gm/turns/actions.js#rejectMoveImpl) so the two never drift.
import { revertMoveEffects } from "@lifeweb/db";
import { cancelOffersForAction } from "@lifeweb/db/lib/lessons";
import { travelClaimsToUndo } from "@lifeweb/db/lib/locationTravel";

// A cooperative lock, not a status (see MOVE_LOCK_TTL_MS in gm/turns/actions.js).
export const MOVE_LOCK_TTL_MS = 90_000;

export function lockIsLive(action, now = new Date()) {
  return Boolean(action.lockExpiresAt && action.lockExpiresAt > now);
}

// The open turn's Action for one character, or null — the whole answer to "can they still act".
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

// Deletes the Action, clawing back anything it already pushed first. A Routine's resources land the
// moment the player confirms (ADJUDICATION.md §5), so deleting without reverting would leave ⬢
// behind. revertMoveEffects reads ONLY the appliedEffects snapshot, so it stays correct even for a
// Move a GM edited in between. Zone-crossing claims (zoneMovesUsed/zoneMovesTurnId) live straight on
// the Character row instead and need their own undo — travelClaimsToUndo works out what.
async function undoTravelClaims(tx, action) {
  const data = travelClaimsToUndo(action);
  if (data) await tx.character.update({ where: { id: action.characterId }, data });
}

// Takes a transaction client: both callers pair this with an audit write that must not commit
// separately. A lesson's Moves go in pairs (db/lib/lessons.js) — rejecting the teacher's takes the
// learners' Gambits with it. Returns the DMs owed, for the caller to send after commit.
export async function deleteActionRestoringTurn(tx, action) {
  const dms = await cancelOffersForAction(tx, action.id);
  if (action.appliedEffects) await revertMoveEffects(tx, action);
  await undoTravelClaims(tx, action);
  await tx.action.deleteMany({ where: { id: action.id } });
  return dms;
}
