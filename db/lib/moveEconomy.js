// Giving a turn back means DELETING the Action row — there is no `turnsRemaining` column.
// Lives in db/lib because three callers now need it and two of them are not the web app:
// the Dev Panel's and the Moves desk's Reject (through web/lib/moveEconomy.js, which
// re-exports this), and a player withdrawing their own Gambit (db/lib/moves.js), which the
// bot reaches as well as the web.
const { revertMoveEffects } = require("./moveEffects");
const { cancelOffersForAction } = require("./lessons");
const { travelClaimsToUndo } = require("./locationTravel");

const MOVE_LOCK_TTL_MS = 90_000;

function lockIsLive(action, now = new Date()) {
  return Boolean(action.lockExpiresAt && action.lockExpiresAt > now);
}

// A Labor Move's resources land at confirm now, so deleting without reverting would leave ⬢ behind.
async function undoTravelClaims(tx, action) {
  const data = travelClaimsToUndo(action);
  if (data) await tx.character.update({ where: { id: action.characterId }, data });
}

// A quest's Interact files a Gambit and records a QuestInteraction beside it
// (db/lib/quests.js). `actionId` there is a bare unique String with NO foreign key, so
// nothing cascades — and its @@unique([questId, characterId, turnId]) is what enforces
// "one press per quest per turn". Left behind, the row outlives the Move it describes
// and goes on holding that slot, so a player who gets their turn back can never spend it
// on that quest again. Undone here rather than in either caller: Reject has had the same
// hole since QuestInteraction existed.
async function undoQuestInteraction(tx, action) {
  await tx.questInteraction.deleteMany({ where: { actionId: action.id } });
}

// Takes a transaction client: every caller pairs this with an audit write that must not commit separately.
// Returns the DMs owed to anyone whose lesson Offer died with the Move.
async function deleteActionRestoringTurn(tx, action) {
  const dms = await cancelOffersForAction(tx, action.id);
  if (action.appliedEffects) await revertMoveEffects(tx, action);
  await undoTravelClaims(tx, action);
  await undoQuestInteraction(tx, action);
  await tx.action.deleteMany({ where: { id: action.id } });
  return dms;
}

module.exports = { MOVE_LOCK_TTL_MS, lockIsLive, deleteActionRestoringTurn };
