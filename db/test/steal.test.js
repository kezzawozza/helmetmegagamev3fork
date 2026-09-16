// The pure half of stealing (db/lib/steal.js). Three things worth pinning: the
// threshold, because it is the whole mechanic and no player can ever check it
// (the die is never shown); that the modifier table is CLOSED, since the
// tempting maintenance move is to reach for gambitModifiers() and quietly add
// Hunger and mood to a free, unlimited verb; and that the drink rungs never
// sum, which is the one arithmetic decision here that is not obvious from the
// table.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  STEAL_TARGET,
  STEAL_MODIFIERS,
  stealModifiers,
  stealModifierTotal,
  stealTotal,
  stealSucceeds,
} = require("../lib/steal");

const held = (...slugs) => slugs.map((slug) => ({ tag: { slug } }));
const mods = (...slugs) => stealModifiers(held(...slugs));
const at = (die, ...slugs) => stealSucceeds(die, mods(...slugs));

test("an average person goes unseen on a 4, 5 or 6", () => {
  assert.equal(STEAL_TARGET, 4);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((d) => at(d)), [false, false, false, true, true, true]);
});

test("Clumsy is -2, so only a 6 gets away with it", () => {
  assert.deepEqual([4, 5, 6].map((d) => at(d, "clumsy")), [false, false, true]);
});

test("Stealth is +2, so only a 1 is seen", () => {
  assert.deepEqual([1, 2, 3].map((d) => at(d, "stealth")), [false, true, true]);
});

test("Tipsy is -1 and the other two rungs are -2", () => {
  assert.equal(stealModifierTotal(held("tipsy")), -1);
  assert.equal(stealModifierTotal(held("wasted")), -2);
  assert.equal(stealModifierTotal(held("blind-drunk")), -2);
});

// The reason this is a test and not a comment: Tipsy escalates into Wasted so
// those two never co-occur, but Blind Drunk comes off a bad drink and nothing
// stops it landing on somebody already Wasted. Summed that pair is -4 and a 6
// that still fails, which is a worse punishment than either tag claims.
test("the drink rungs never sum — the worst one counts", () => {
  assert.deepEqual(mods("wasted", "blind-drunk"), [{ label: "Blind Drunk", value: -2 }]);
  assert.equal(stealModifierTotal(held("tipsy", "wasted", "blind-drunk")), -2);
});

test("hands and drink DO stack with each other", () => {
  assert.equal(stealModifierTotal(held("stealth", "tipsy")), 1);
  // Net +1, so the threshold moves down one rung and no further.
  assert.equal(at(3, "stealth", "tipsy"), true);
  assert.equal(at(2, "stealth", "tipsy"), false);
});

test("the table is closed — nothing else moves the die", () => {
  assert.deepEqual(
    STEAL_MODIFIERS.map(([slug]) => slug).sort(),
    ["blind-drunk", "clumsy", "stealth", "tipsy", "wasted"],
  );
  // Subtle reads like it belongs and deliberately does not (it is the whisper
  // tag now). Hunger and the mood bands are gambitModifiers()' business and
  // must not leak in here.
  for (const slug of ["subtle", "hunger", "spotter", "lucky", "pickpocket"]) {
    assert.deepEqual(mods(slug), [], `${slug} must not move a steal`);
  }
});

test("modifiers read in table order, not held order", () => {
  assert.deepEqual(mods("tipsy", "stealth"), mods("stealth", "tipsy"));
});

test("stealTotal is the die plus the list", () => {
  assert.equal(stealTotal(3, mods("stealth")), 5);
  assert.equal(stealTotal(3, []), 3);
});

test("tolerates a bare Tag[] as well as CharacterTag[]", () => {
  assert.deepEqual(stealModifiers([{ slug: "clumsy" }]), [{ label: "Clumsy", value: -2 }]);
});
