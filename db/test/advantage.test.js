// node --test over db/lib/advantage.js — Lucky's roll-twice-keep-the-better
// die. Run
// with `npm test --workspace=db`. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const { rollWithAdvantage, formatAdvantage } = require("../lib/advantage");

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

// The push on's two-sided die (rollWithEdge): votes for and against, ties
// roll once, and the roll line names what decided it.
const { rollWithEdge, edgeFor } = require("../lib/advantage");
const BETTER = new Set(["lucky", "quick-footed"]);
const WORSE = new Set(["fat", "old"]);
const held = (...pairs) => pairs.map(([slug, name]) => ({ tag: { slug, name } }));

test("rollWithEdge: nothing held, or a tie, throws one die", () => {
  for (let i = 0; i < 20; i++) {
    const plain = rollWithEdge(held(), { better: BETTER, worse: WORSE });
    assert.equal(plain.rolls.length, 1);
    assert.equal(plain.edge, null);
    const tie = rollWithEdge(held(["quick-footed", "Quick-Footed"], ["fat", "Fat"]), { better: BETTER, worse: WORSE });
    assert.equal(tie.rolls.length, 1);
    assert.equal(tie.edge, null);
  }
});

test("rollWithEdge: the majority keeps the better or the worse of two", () => {
  for (let i = 0; i < 40; i++) {
    const up = rollWithEdge(held(["lucky", "Lucky"], ["quick-footed", "Quick-Footed"], ["fat", "Fat"]), { better: BETTER, worse: WORSE });
    assert.equal(up.rolls.length, 2);
    assert.equal(up.die, Math.max(...up.rolls));
    assert.equal(up.edge, "better");
    assert.deepEqual(up.names, ["Lucky", "Quick-Footed"]);
    const down = rollWithEdge(held(["old", "Old"]), { better: BETTER, worse: WORSE });
    assert.equal(down.rolls.length, 2);
    assert.equal(down.die, Math.min(...down.rolls));
    assert.equal(down.edge, "worse");
    assert.deepEqual(down.names, ["Old"]);
  }
});

test("edgeFor: the decision alone, no die thrown", () => {
  assert.deepEqual(edgeFor(held(["lucky", "Lucky"], ["quick-footed", "Quick-Footed"]), { better: BETTER, worse: WORSE }), { edge: "better", names: ["Lucky", "Quick-Footed"] });
  assert.deepEqual(edgeFor(held(["fat", "Fat"]), { better: BETTER, worse: WORSE }), { edge: "worse", names: ["Fat"] });
  assert.deepEqual(edgeFor(held(), { better: BETTER, worse: WORSE }), { edge: null, names: [] });
});
