// node --test over the pure half of db/lib/stablePass.js — hatchCount's
// real per-unit variance, same posture as db/test/soilery.test.js's own
// reap() coverage. Nothing here touches Prisma; the feed/lay/age/evict
// orchestration needs a database (room locks, RoomTag writes) and is
// exercised by hand per LOCAL-DEV.md, same note db/test/trinketPass.test.js
// and mood.test.js give for the rest of their own modules.
//
// Hand-verified against a local Postgres (docs/systemdocs/LOCAL-DEV.md):
// seeded a `farms-stable` room with 5 adults, 4 yearlings, 1 youngling, 1
// hatchling and 20 wheat, ran runStablePass, and confirmed — the 4 yearlings
// matured to unruly-arelitz and counted as adults THIS SAME pass (9 adults
// total), 9 adults ate 18 of the 20 wheat and laid 9 eggs, one of those 9
// hatched, and the resulting 12-strong stable (over the default capacity of
// 10) evicted its 2 youngest brood (the newly-aged youngling and the fresh
// hatchling) to farms-fields, in that order.
const test = require("node:test");
const assert = require("node:assert/strict");
const { hatchCount } = require("../lib/stablePass");
const { HATCH_IN } = require("../lib/constants");

test("hatchCount: a rng that never rolls the hatch slot hatches nothing", () => {
  assert.equal(hatchCount(60, () => 0.99), 0);
});

test("hatchCount: a rng that always rolls the hatch slot hatches everything", () => {
  // floor(0 * HATCH_IN) === 0 every time, which is the hatch branch.
  assert.equal(hatchCount(60, () => 0), 60);
});

test("hatchCount: 0 eggs hatches 0, with no rng calls needed", () => {
  assert.equal(hatchCount(0), 0);
});

test("hatchCount: real per-unit variance, not a rounded average — a large sample lands within 3 std dev of the true mean", () => {
  const eggs = 6000;
  const hatched = hatchCount(eggs);
  const mean = eggs * (1 / HATCH_IN);
  const variance = eggs * (1 / HATCH_IN) * (1 - 1 / HATCH_IN);
  const stdDev = Math.sqrt(variance);
  assert.ok(
    Math.abs(hatched - mean) <= 3 * stdDev,
    `hatched ${hatched} is more than 3 std dev (${stdDev.toFixed(1)}) from the expected mean ${mean}`,
  );
});
