// node --test over the pure half of db/lib/breakRestraints.js — the
// escalating threshold table (LESSONS.md §3c). Run with
// `npm test --workspace=db`. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  breakRestraintsThreshold,
  resolveBreakRestraints,
} = require("../lib/breakRestraints");

test("neither trait: 6 on turn 1; 5,6 on turn 2; automatic from turn 3", () => {
  assert.equal(breakRestraintsThreshold(0, []), 6);
  assert.equal(breakRestraintsThreshold(1, []), 5);
  assert.equal(breakRestraintsThreshold(2, []), null);
  assert.equal(breakRestraintsThreshold(3, []), null);
});

test("Escape Artist: 5,6 on turn 1; 3-6 on turn 2; automatic from turn 3", () => {
  assert.equal(breakRestraintsThreshold(0, ["escape-artist"]), 5);
  assert.equal(breakRestraintsThreshold(1, ["escape-artist"]), 3);
  assert.equal(breakRestraintsThreshold(2, ["escape-artist"]), null);
  assert.equal(breakRestraintsThreshold(0, new Set(["escape-artist"])), 5);
});

test("Giant changes nothing, alone or with Escape Artist", () => {
  for (const elapsed of [0, 1, 2]) {
    assert.equal(breakRestraintsThreshold(elapsed, ["giant"]), breakRestraintsThreshold(elapsed, []));
    assert.equal(
      breakRestraintsThreshold(elapsed, ["escape-artist", "giant"]),
      breakRestraintsThreshold(elapsed, ["escape-artist"]),
    );
  }
});

test("a negative elapsed count floors to 0 rather than throwing or going easier", () => {
  assert.equal(breakRestraintsThreshold(-1, []), breakRestraintsThreshold(0, []));
  assert.equal(breakRestraintsThreshold(-5, ["escape-artist"]), breakRestraintsThreshold(0, ["escape-artist"]));
});

test("resolveBreakRestraints: automatic succeeds with no die comparison", () => {
  const result = resolveBreakRestraints({ die: 1, turnsElapsed: 2, heldSlugs: [] });
  assert.equal(result.automatic, true);
  assert.equal(result.threshold, null);
  assert.equal(result.success, true);
});

test("resolveBreakRestraints: a rolled result compares the die to the threshold", () => {
  assert.equal(resolveBreakRestraints({ die: 5, turnsElapsed: 0, heldSlugs: [] }).success, false);
  assert.equal(resolveBreakRestraints({ die: 6, turnsElapsed: 0, heldSlugs: [] }).success, true);
  assert.equal(resolveBreakRestraints({ die: 4, turnsElapsed: 1, heldSlugs: [] }).success, false);
  assert.equal(resolveBreakRestraints({ die: 5, turnsElapsed: 1, heldSlugs: [] }).success, true);
});
