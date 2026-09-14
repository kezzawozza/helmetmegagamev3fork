// node --test over db/lib/locationTravel.js#travelClaimsToUndo — what
// restoring a GM-reset (or rejected) Move should also undo on the Character
// row: the zoneMovesUsed/zoneMovesBonusUsed/zoneMovesTurnId counters every
// crossing this turn claims against, free or paid, base or bonus. Pure
// function, no Prisma, no tx.
const test = require("node:test");
const assert = require("node:assert/strict");
const { travelClaimsToUndo } = require("../lib/locationTravel");

const TURN_A = "turn-a";
const TURN_B = "turn-b";

// `action`-shaped input: { turnId, characterId, character: {...} }.
const actionFor = (character, turnId = TURN_A) => ({
  turnId,
  characterId: "char-1",
  character,
});

test("nothing to undo: no zone-move claim", () => {
  const action = actionFor({ zoneMovesTurnId: null });
  assert.equal(travelClaimsToUndo(action), null);
});

test("no character on the action at all", () => {
  assert.equal(travelClaimsToUndo({ turnId: TURN_A, characterId: "char-1" }), null);
});

test("a free crossing spent this turn resets both counters", () => {
  const action = actionFor({ zoneMovesTurnId: TURN_A });
  assert.deepEqual(travelClaimsToUndo(action), {
    zoneMovesUsed: 0,
    zoneMovesBonusUsed: 0,
    zoneMovesTurnId: null,
  });
});

test("a crossing charged to the mount/boat bonus also gives that back", () => {
  // The base/bonus split (locationTravel.js#movesLeft): a crossing charged
  // to the bonus pool stays charged to it for the rest of the turn, so
  // undoing the Action that charged it has to hand back both counters, not
  // just the flat zoneMovesUsed total.
  const action = actionFor({
    zoneMovesTurnId: TURN_A,
    zoneMovesUsed: 1,
    zoneMovesBonusUsed: 1,
  });
  assert.deepEqual(travelClaimsToUndo(action), {
    zoneMovesUsed: 0,
    zoneMovesBonusUsed: 0,
    zoneMovesTurnId: null,
  });
});

test("a zone-move claim from a different turn is left alone", () => {
  const action = actionFor({ zoneMovesTurnId: TURN_B });
  assert.equal(travelClaimsToUndo(action), null);
});
