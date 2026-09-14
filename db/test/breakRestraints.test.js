// node --test over the pure half of db/lib/breakRestraints.js — the
// escalating threshold table (LESSONS.md §3c). Run with
// `npm test --workspace=db`. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  breakRestraintsThreshold,
  resolveBreakRestraints,
} = require("../lib/breakRestraints");

test("neither trait: 5,6 on turn 1; 3-6 on turn 2; automatic from turn 3", () => {
  assert.equal(breakRestraintsThreshold(0, []), 5);
  assert.equal(breakRestraintsThreshold(1, []), 3);
  assert.equal(breakRestraintsThreshold(2, []), null);
  assert.equal(breakRestraintsThreshold(3, []), null);
});

test("Escape Artist: 3-6 on turn 1, automatic from turn 2", () => {
  assert.equal(breakRestraintsThreshold(0, ["escape-artist"]), 3);
  assert.equal(breakRestraintsThreshold(1, ["escape-artist"]), null);
  assert.equal(breakRestraintsThreshold(2, ["escape-artist"]), null);
});

test("Giant: 4-6 on turn 1, 3-6 on turn 2, automatic from turn 3", () => {
  assert.equal(breakRestraintsThreshold(0, ["giant"]), 4);
  assert.equal(breakRestraintsThreshold(1, ["giant"]), 3);
  assert.equal(breakRestraintsThreshold(2, ["giant"]), null);
});

test("Escape Artist and Giant together: automatic from turn 1, Bascinet's ruling", () => {
  assert.equal(breakRestraintsThreshold(0, ["escape-artist", "giant"]), null);
  assert.equal(breakRestraintsThreshold(1, ["escape-artist", "giant"]), null);
  const heldSet = new Set(["escape-artist", "giant"]);
  assert.equal(breakRestraintsThreshold(0, heldSet), null);
});

test("a negative elapsed count floors to 0 rather than throwing or going easier", () => {
  assert.equal(breakRestraintsThreshold(-1, []), breakRestraintsThreshold(0, []));
  assert.equal(breakRestraintsThreshold(-5, ["giant"]), breakRestraintsThreshold(0, ["giant"]));
});

test("resolveBreakRestraints: automatic succeeds with no die comparison", () => {
  const result = resolveBreakRestraints({ die: 1, turnsElapsed: 2, heldSlugs: [] });
  assert.equal(result.automatic, true);
  assert.equal(result.threshold, null);
  assert.equal(result.success, true);
});

test("resolveBreakRestraints: a rolled result compares the die to the threshold", () => {
  assert.equal(resolveBreakRestraints({ die: 4, turnsElapsed: 0, heldSlugs: [] }).success, false);
  assert.equal(resolveBreakRestraints({ die: 5, turnsElapsed: 0, heldSlugs: [] }).success, true);
  assert.equal(resolveBreakRestraints({ die: 6, turnsElapsed: 0, heldSlugs: [] }).success, true);
});
