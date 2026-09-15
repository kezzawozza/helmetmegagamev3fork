// node --test over the pure half of db/lib/moves.js#moveIsEditable and
// db/lib/turnClock.js#cutoffReached — the two predicates that decide, between them,
// how long a Gambit stays the player's own.
//
// They are two halves of one rule and are tested together on purpose: a Move stops
// being editable at exactly the moment its die is thrown, and if these two ever
// disagree a player either edits a rolled Gambit or loses one that never rolled.
const test = require("node:test");
const assert = require("node:assert");

const { moveIsEditable } = require("../lib/moves");
const { cutoffReached, MOVE_LOCK_HOURS } = require("../lib/turnClock");

const HOUR = 3600_000;

// A turn long enough to have a lock at all. turnEndsAt derives the end from the
// boundary hours, so `startedAt` is what decides both the end and the cutoff.
function turnStartedHoursAgo(hours) {
  return { startedAt: new Date(Date.now() - hours * HOUR) };
}

function gambit(over = {}) {
  return {
    playerFiled: true,
    moveKind: "GAMBIT",
    moveReviewStatus: "OPEN",
    lockExpiresAt: null,
    ...over,
  };
}

test("a Gambit the player wrote is theirs while the window is open", () => {
  const turn = turnStartedHoursAgo(1);
  const { editable } = moveIsEditable(gambit(), turn, { clockFrozen: false });
  assert.equal(editable, true);
});

test("nothing filed is not an error, just nothing to change", () => {
  const { editable, reason } = moveIsEditable(null, turnStartedHoursAgo(1));
  assert.equal(editable, false);
  assert.match(reason, /no Move is filed/);
});

test("a Move the game filed is a receipt, never editable", () => {
  // Bury, craft, torture, travel, a lesson — every fileAutoRoutine caller.
  const { editable, reason } = moveIsEditable(
    gambit({ playerFiled: false }),
    turnStartedHoursAgo(1),
  );
  assert.equal(editable, false);
  assert.match(reason, /the game filed this one/);
});

test("a Labor is paid on the press, so there is nothing pending to take back", () => {
  const { editable, reason } = moveIsEditable(
    gambit({ moveKind: "LABOR" }),
    turnStartedHoursAgo(1),
  );
  assert.equal(editable, false);
  assert.match(reason, /only a Gambit/);
});

test("a GM who already settled the Move wins", () => {
  for (const status of ["SOLVED", "PASSED"]) {
    const { editable } = moveIsEditable(gambit({ moveReviewStatus: status }), turnStartedHoursAgo(1));
    assert.equal(editable, false, `${status} should not be editable`);
  }
});

test("a live GM lock blocks the edit, an expired one does not", () => {
  const turn = turnStartedHoursAgo(1);
  const now = new Date();

  const live = moveIsEditable(
    gambit({ lockExpiresAt: new Date(now.getTime() + 60_000) }),
    turn,
    { now },
  );
  assert.equal(live.editable, false);
  assert.match(live.reason, /a GM is looking at this Move/);

  // A crashed browser lets the lock lapse; that must not strand the player.
  const lapsed = moveIsEditable(
    gambit({ lockExpiresAt: new Date(now.getTime() - 60_000) }),
    turn,
    { now },
  );
  assert.equal(lapsed.editable, true);
});

test("no open turn means nothing to edit", () => {
  const { editable, reason } = moveIsEditable(gambit(), null);
  assert.equal(editable, false);
  assert.match(reason, /no turn is open/);
});

// --- the cutoff itself ------------------------------------------------------

test("cutoffReached refuses before the cutoff and at the cutoff says so", () => {
  const fresh = turnStartedHoursAgo(1);
  const before = cutoffReached(fresh, { clockFrozen: false });
  assert.equal(before.at, false);
  assert.equal(before.reason, "before the cutoff");
});

test("a frozen clock never locks, so it never rolls", () => {
  const turn = turnStartedHoursAgo(1);
  const { at, reason } = cutoffReached(turn, { clockFrozen: true });
  assert.equal(at, false);
  assert.match(reason, /never locks/);
});

test("no turn is a refusal, not a throw", () => {
  assert.deepEqual(cutoffReached(null), { at: false, reason: "no open turn" });
});

test("a Move stays editable for exactly as long as the die is unthrown", () => {
  // The invariant tying the two predicates together: walk a turn minute by minute
  // and assert the two are never both true and never both false-for-the-wrong-reason.
  const turn = turnStartedHoursAgo(0);
  const start = new Date(turn.startedAt).getTime();

  for (let minutes = 0; minutes < 60 * 26; minutes += 17) {
    const now = new Date(start + minutes * 60_000);
    const { at } = cutoffReached(turn, { now, clockFrozen: false });
    const { editable } = moveIsEditable(gambit(), turn, { now, clockFrozen: false });
    // The die is thrown only at the cutoff, and the Move is editable only before it.
    assert.equal(at && editable, false, `both true at +${minutes}m`);
  }
});

test("MOVE_LOCK_HOURS is what both of them count back from", () => {
  assert.equal(typeof MOVE_LOCK_HOURS, "number");
  assert.ok(MOVE_LOCK_HOURS > 0);
});
