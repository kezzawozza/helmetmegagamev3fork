// db/lib/oracleCutoff.js's pure half: when to draft, and which phase.
// See docs/systemdocs/ORACLE.md §2 and db/test/oracle.test.js for the plain
// cutoff-vs-lock-window tests that predate the two-phase split.

const test = require("node:test");
const assert = require("node:assert");

const { moveCutoffAt } = require("../lib/turnClock");
const { cutoffDecision } = require("../lib/oracleCutoff");

// A turn started well before its cutoff, long enough to lock — the same
// shape (and one of the same days) as db/test/oracle.test.js's DAY_TWO fixture.
const TURN = { id: "t1", number: 12, startedAt: new Date("2026-09-09T18:00:00Z") };

// A turn too short to ever lock — opened at 23:00 Chicago, so its derived end
// (the coming midnight) is only an hour later, well under the three-hour
// lock. moveWindow().hasLock is false and no lead window exists.
const SHORT_TURN = { id: "t2", number: 13, startedAt: new Date("2026-09-09T04:00:00Z") };

test("ten minutes before the cutoff: no draft", () => {
  const now = new Date(moveCutoffAt(TURN).getTime() - 10 * 60 * 1000);
  const { draft, phase } = cutoffDecision(TURN, { now });
  assert.strictEqual(draft, false);
  assert.strictEqual(phase, null);
});

test("exactly five minutes before the cutoff: phase one", () => {
  const now = new Date(moveCutoffAt(TURN).getTime() - 5 * 60 * 1000);
  const { draft, phase, reason } = cutoffDecision(TURN, { now });
  assert.strictEqual(draft, true);
  assert.strictEqual(phase, 1);
  assert.strictEqual(reason, "five minutes before the cutoff");
});

test("one minute before the cutoff: still phase one", () => {
  const now = new Date(moveCutoffAt(TURN).getTime() - 60 * 1000);
  const { draft, phase } = cutoffDecision(TURN, { now });
  assert.strictEqual(draft, true);
  assert.strictEqual(phase, 1);
});

test("at the cutoff: phase two", () => {
  const now = moveCutoffAt(TURN);
  const { draft, phase, reason } = cutoffDecision(TURN, { now });
  assert.strictEqual(draft, true);
  assert.strictEqual(phase, 2);
  assert.strictEqual(reason, "at the cutoff");
});

test("ninety minutes after the cutoff, still inside the lock: phase two", () => {
  const now = new Date(moveCutoffAt(TURN).getTime() + 90 * 60 * 1000);
  const { draft, phase } = cutoffDecision(TURN, { now });
  assert.strictEqual(draft, true);
  assert.strictEqual(phase, 2);
});

test("a frozen clock inside the lead window never drafts", () => {
  const now = new Date(moveCutoffAt(TURN).getTime() - 2 * 60 * 1000);
  const { draft, phase } = cutoffDecision(TURN, { now, clockFrozen: true });
  assert.strictEqual(draft, false);
  assert.strictEqual(phase, null);
});

test("a turn too short to lock never drafts, even inside what would be the lead window", () => {
  const now = new Date(SHORT_TURN.startedAt.getTime() + 10 * 60 * 1000);
  const { draft, phase, reason } = cutoffDecision(SHORT_TURN, { now });
  assert.strictEqual(draft, false);
  assert.strictEqual(phase, null);
  assert.strictEqual(reason, "this turn never locks");
});
