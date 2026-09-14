// node --test over db/lib/advantage.js — Lucky's roll-twice-keep-the-better
// die, and the labor drop die's Scavenging remap that rides beside it. Run
// with `npm test --workspace=db`. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const { rollWithAdvantage, formatAdvantage } = require("../lib/advantage");
const { scavengingMayFallBack, SCAVENGING_FALLBACK_TO } = require("../lib/laborDrops");

const LUCKY = [{ tag: { slug: "lucky" } }];

test("Lucky is recognised in both tag shapes, and nothing else is", () => {
  assert.equal(rollWithAdvantage(LUCKY).advantage, true);
  assert.equal(rollWithAdvantage([{ slug: "lucky" }]).advantage, true);
  assert.equal(rollWithAdvantage([{ tag: { slug: "brave" } }]).advantage, false);
  assert.equal(rollWithAdvantage([]).advantage, false);
  assert.equal(rollWithAdvantage(undefined).advantage, false);
});

test("without Lucky exactly one die is thrown", () => {
  for (let i = 0; i < 200; i++) {
    const r = rollWithAdvantage([]);
    assert.equal(r.rolls.length, 1);
    assert.equal(r.advantage, false);
    assert.equal(r.die, r.rolls[0]);
    assert.ok(r.die >= 1 && r.die <= 6);
  }
});

test("with Lucky two dice are thrown and the better one counts", () => {
  for (let i = 0; i < 200; i++) {
    const r = rollWithAdvantage(LUCKY);
    assert.equal(r.rolls.length, 2);
    assert.equal(r.advantage, true);
    assert.equal(r.die, Math.max(...r.rolls));
  }
});

test("Lucky lifts the average roll by roughly a point", () => {
  const mean = (tags) => {
    let sum = 0;
    for (let i = 0; i < 60000; i++) sum += rollWithAdvantage(tags).die;
    return sum / 60000;
  };
  assert.ok(Math.abs(mean([]) - 3.5) < 0.1, "a plain d6 averages 3.5");
  assert.ok(Math.abs(mean(LUCKY) - 4.472) < 0.1, "advantage on a d6 averages 4.47");
});

test("the roll line names Lucky only when it actually fired", () => {
  assert.equal(formatAdvantage({ rolls: [3], advantage: false }), null);
  assert.equal(formatAdvantage({ rolls: [6, 2], advantage: true }), "(6, 2 — Lucky)");
});

// Says only WHICH faces may fall back; whether one does depends on the pool
// (pickLaborDropOption).
test("Scavenging may fall back from a 4 or a 5, and never from a 1", () => {
  const scav = new Set(["laboring-scavenging"]);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((r) => scavengingMayFallBack(r, scav)),
    [false, false, false, true, true, false],
  );
});

test("nobody else falls back at all", () => {
  for (const r of [1, 2, 3, 4, 5, 6]) {
    assert.equal(scavengingMayFallBack(r, new Set()), false);
    assert.equal(scavengingMayFallBack(r, new Set(["laboring-skilled"])), false);
  }
});

test("scavengingMayFallBack takes an array as readily as a Set", () => {
  assert.equal(scavengingMayFallBack(4, ["laboring-scavenging"]), true);
  assert.equal(scavengingMayFallBack(4, []), false);
});

// A blanket 4/5->6 remap became a DOWNGRADE once Prospecting filled in 2, 4,
// 5. Falling back only from an EMPTY pool can never take a payout away.
test("the fallback face is the 6, and a 1 is never touched", () => {
  assert.equal(SCAVENGING_FALLBACK_TO, 6);
  assert.equal(scavengingMayFallBack(1, new Set(["laboring-scavenging"])), false);
});
