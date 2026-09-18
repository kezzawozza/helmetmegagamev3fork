// The Oracle's chat sample — a budgeted, place-spread slice of a zone's day,
// never the whole transcript. See docs/systemdocs/ORACLE.md §3 and
// db/lib/oracleChatSample.js.

const test = require("node:test");
const assert = require("node:assert");

const { CHAT_TOKEN_BUDGET, estimateTokens, sampleChat } = require("../lib/oracleChatSample");

// A tiny seedable PRNG (mulberry32) so "the same seed gives the same sample
// twice" can be tested without sharing mutable state between the two calls.
function seededRandom(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function line(placeKey, content, sentAt) {
  return { placeKey, threadName: `Room ${placeKey}`, content, sentAt, characterName: "Someone" };
}

test("empty input gives an empty array, not a throw", () => {
  assert.deepStrictEqual(sampleChat([]), []);
  assert.deepStrictEqual(sampleChat(undefined), []);
});

test("total estimated tokens across every place never exceeds the budget", () => {
  const rows = [];
  for (let i = 0; i < 200; i += 1) {
    rows.push(line(`place-${i % 4}`, "word ".repeat(30), new Date(2026, 0, 1, 0, i).toISOString()));
  }
  const groups = sampleChat(rows, { budget: 500, random: seededRandom(1) });
  const total = groups.reduce(
    (sum, g) => sum + g.taken.reduce((s, row) => s + estimateTokens(row.content), 0),
    0,
  );
  assert.ok(total <= 500, `total ${total} exceeded the 500-token budget`);
});

test("one busy place cannot spend another's share", () => {
  // A quiet place with one short line, and a busy place with far more than
  // its equal share could ever hold. The quiet place's unused share may be
  // redistributed to the busy one (second pass), but the busy place must
  // never simply help itself to the whole budget.
  const quiet = [line("quiet", "hi", "2026-01-01T00:00:00Z")];
  const busy = [];
  for (let i = 0; i < 100; i += 1) {
    busy.push(line("busy", "word ".repeat(20), new Date(2026, 0, 1, 0, i).toISOString()));
  }
  const groups = sampleChat([...quiet, ...busy], { budget: 400, random: seededRandom(2) });
  const busyGroup = groups.find((g) => g.label === "Room busy");
  const busySpent = busyGroup.taken.reduce((s, row) => s + estimateTokens(row.content), 0);
  assert.ok(busySpent <= 400, `busy place spent ${busySpent} of a 400 budget shared with another place`);
});

test("a seeded random gives the same sample twice", () => {
  const rows = [];
  for (let i = 0; i < 30; i += 1) {
    rows.push(line("place", `line ${i}`, new Date(2026, 0, 1, 0, i).toISOString()));
  }
  const first = sampleChat(rows, { budget: 60, random: seededRandom(42) });
  const second = sampleChat(rows, { budget: 60, random: seededRandom(42) });
  assert.deepStrictEqual(
    first.map((g) => g.taken.map((r) => r.content)),
    second.map((g) => g.taken.map((r) => r.content)),
  );
});

test("lines within a place come back in sentAt order", () => {
  const rows = [
    line("place", "third", "2026-01-01T00:03:00Z"),
    line("place", "first", "2026-01-01T00:01:00Z"),
    line("place", "second", "2026-01-01T00:02:00Z"),
  ];
  const [group] = sampleChat(rows, { budget: 1000, random: seededRandom(7) });
  assert.deepStrictEqual(
    group.taken.map((r) => r.content),
    ["first", "second", "third"],
  );
});

test("an over-budget single line is skipped and shorter lines behind it still get in", () => {
  const rows = [
    line("place", "word ".repeat(100), "2026-01-01T00:00:00Z"), // far too big for the budget
    line("place", "short", "2026-01-01T00:01:00Z"),
  ];
  const [group] = sampleChat(rows, { budget: 5, random: seededRandom(3) });
  assert.deepStrictEqual(
    group.taken.map((r) => r.content),
    ["short"],
  );
  assert.equal(group.sampledCount, 1);
  assert.equal(group.totalCount, 2);
});

test("estimateTokens is chars / 4, rounded up, and tolerant of nullish input", () => {
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(undefined), 0);
});

test("CHAT_TOKEN_BUDGET is the documented 2000", () => {
  assert.equal(CHAT_TOKEN_BUDGET, 2000);
});
