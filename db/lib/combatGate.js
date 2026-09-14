// THE GATE ON ATTACK (docs/systemdocs/ATTACK.md §5a). Attack is free, so it's a lever: with your Move
// already filed, pressing it only pins somebody for the rest of the day.

// A Move already filed spends the turn — unless it's a GAMBIT. NO moveKind counts as spent, not as
// nothing filed — db/lib/locationTravel.js files a paid zone crossing with the column left null, and
// that crossing cost the turn. Kept as the row test, not the kind, so a writer that forgets the column fails closed.
function spentBy(action) {
  return Boolean(action) && action.moveKind !== "GAMBIT";
}

// Bascinet's words, verbatim.
const ATTACK_MOVE_SPENT =
  "You've already used your Move this turn. You should only Attack if you plan to use your Gambit to actually declare your combat.";

// `db` is a parameter for the db/lib/dm.js reason: requiring the barrel back
// from inside db/lib/ resolves to a partial exports object.
async function moveSpent(db, characterId, turnId) {
  if (!turnId) return false;
  return spentBy(
    await db.action.findFirst({ where: { characterId, turnId }, select: { moveKind: true } }),
  );
}

// The heldReasonFor shape (db/lib/intercept.js): sentence or null, so the button greying and the
// server action refusal never disagree about why.
async function attackMoveBlock(db, characterId, turnId) {
  return (await moveSpent(db, characterId, turnId)) ? ATTACK_MOVE_SPENT : null;
}

module.exports = {
  spentBy,
  attackMoveBlock,
};
