// THE GATE ON ATTACK (docs/systemdocs/ATTACK.md §5a).
//
// Attack is free, and that is what made it a lever: with your Move already
// filed on something else, pressing it only pins somebody where they stand
// for the rest of the day. The doc has the whole argument.

// A Move already filed spends the turn — unless it is a GAMBIT, which is the
// fight itself written up first and the button pressed second.
//
// NO moveKind counts as spent, not as nothing filed. db/lib/locationTravel.js
// files a paid zone crossing with the column left null, and that crossing cost
// the whole turn; reading it as "hasn't acted" would let anybody who walked
// across a boundary pin somebody anyway, which is the exact case this exists
// for. Kept as the row test rather than the kind so a second writer that
// forgets the column fails closed too.
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

// The heldReasonFor shape (db/lib/intercept.js): the sentence or null, so the
// dialog that greys a button and the server action that refuses the post can
// never disagree about why.
async function attackMoveBlock(db, characterId, turnId) {
  return (await moveSpent(db, characterId, turnId)) ? ATTACK_MOVE_SPENT : null;
}

module.exports = {
  spentBy,
  attackMoveBlock,
};
