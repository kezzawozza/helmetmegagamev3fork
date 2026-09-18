// The spent-Move gate Attack and Intercept share (docs/systemdocs/ATTACK.md
// §5a). The pure half — no prisma, just the row.
const test = require("node:test");
const assert = require("node:assert");

const { spentBy } = require("../lib/combatGate");

test("nothing filed yet leaves both verbs open", () => {
  assert.equal(spentBy(null), false);
  assert.equal(spentBy(undefined), false);
});

test("a Routine spends the turn", () => {
  assert.equal(spentBy({ moveKind: "ROUTINE" }), true);
  assert.equal(spentBy({ moveKind: "ROUTINE" }), true);
});

test("a Gambit is the exception", () => {
  assert.equal(spentBy({ moveKind: "GAMBIT" }), false);
});

// A paid zone crossing files with no moveKind at all (db/lib/locationTravel.js).
test("a filed Move with no kind still spends the turn", () => {
  assert.equal(spentBy({ moveKind: null }), true);
  assert.equal(spentBy({}), true);
});
