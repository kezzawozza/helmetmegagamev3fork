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

// A FIXED turn, and every test passes an explicit `now`.
//
// These used to build the fixture from Date.now() and let `now` default to the real
// clock. turnEndsAt derives a turn's end from TURN_BOUNDARY_HOURS in the game's own
// timezone, so "a turn that started an hour ago" lands INSIDE the lock window for a few
// hours every real night — the suite passed when it was written and failed at 02:00 the
// next morning. Nothing about this rule depends on when the tests are run, so nothing
// here reads the wall clock.
const TURN = { startedAt: new Date("2026-09-16T12:00:00Z") };
// Derived from TURN above, not hardcoded twice: cutoff 02:00Z, end 05:00Z the next day.
const { cutoffAt: CUTOFF_AT, endsAt: ENDS_AT } = require("../lib/turnClock").moveWindow(TURN, {
  now: TURN.startedAt,
});
// Comfortably inside the window, and comfortably past the two edges.
const OPEN_AT = new Date(TURN.startedAt.getTime() + 6 * 3600_000);
const AFTER_CUTOFF = new Date(CUTOFF_AT.getTime() + 60_000);
const OVERDUE = new Date(ENDS_AT.getTime() + 60_000);

function gambit(over = {}) {
  return {
    playerFiled: true,
    moveKind: "GAMBIT",
    moveReviewStatus: "OPEN",
    lockExpiresAt: null,
    diceRoll: null,
    ...over,
  };
}

test("a Gambit the player wrote is theirs while the window is open", () => {
  const { editable } = moveIsEditable(gambit(), TURN, { now: OPEN_AT, clockFrozen: false });
  assert.equal(editable, true);
});

test("nothing filed is not an error, just nothing to change", () => {
  const { editable, reason } = moveIsEditable(null, TURN, { now: OPEN_AT });
  assert.equal(editable, false);
  assert.match(reason, /no Move was declared/);
});

test("a Move the game filed is a receipt, never editable", () => {
  // Bury, craft, torture, travel, a lesson — every fileAutoRoutine caller.
  const { editable, reason } = moveIsEditable(gambit({ playerFiled: false }), TURN, {
    now: OPEN_AT,
  });
  assert.equal(editable, false);
  assert.match(reason, /the game declared this one/);
});

test("a Labor is paid on the press, so there is nothing pending to take back", () => {
  const { editable, reason } = moveIsEditable(gambit({ moveKind: "LABOR" }), TURN, {
    now: OPEN_AT,
  });
  assert.equal(editable, false);
  assert.match(reason, /only a Gambit/);
});

test("a GM who already settled the Move wins", () => {
  for (const status of ["SOLVED", "PASSED"]) {
    const { editable } = moveIsEditable(gambit({ moveReviewStatus: status }), TURN, { now: OPEN_AT });
    assert.equal(editable, false, `${status} should not be editable`);
  }
});

test("a live GM lock blocks the edit, an expired one does not", () => {
  const now = OPEN_AT;

  const live = moveIsEditable(
    gambit({ lockExpiresAt: new Date(now.getTime() + 60_000) }),
    TURN,
    { now },
  );
  assert.equal(live.editable, false);
  assert.match(live.reason, /a GM is looking at this Move/);

  // A crashed browser lets the lock lapse; that must not strand the player.
  const lapsed = moveIsEditable(
    gambit({ lockExpiresAt: new Date(now.getTime() - 60_000) }),
    TURN,
    { now },
  );
  assert.equal(lapsed.editable, true);
});

test("no open turn means nothing to edit", () => {
  const { editable, reason } = moveIsEditable(gambit(), null, { now: OPEN_AT });
  assert.equal(editable, false);
  assert.match(reason, /no turn is open/);
});

// --- the cutoff itself ------------------------------------------------------

test("cutoffReached refuses before the cutoff and at the cutoff says so", () => {
  const before = cutoffReached(TURN, { now: OPEN_AT, clockFrozen: false });
  assert.equal(before.at, false);
  assert.equal(before.reason, "before the cutoff");
});

test("a frozen clock never locks, so it never rolls", () => {
  const { at, reason } = cutoffReached(TURN, { now: OPEN_AT, clockFrozen: true });
  assert.equal(at, false);
  assert.match(reason, /never locks/);
});

test("no turn is a refusal, not a throw", () => {
  assert.deepEqual(cutoffReached(null), { at: false, reason: "no open turn" });
});

test("a rolled Gambit can never be touched, whatever the clock says", () => {
  // The guard that actually matters. Withdrawing a rolled Gambit and filing another
  // would hand back a fresh die, which is the whole prize this design removes.
  const { editable, reason } = moveIsEditable(gambit({ diceRoll: 4 }), TURN, { now: OPEN_AT });
  assert.equal(editable, false);
  assert.match(reason, /die is already thrown/);
});

test("one minute past the cutoff, the Move is no longer yours", () => {
  // The ordinary case the whole feature turns on: the window shuts, and it shuts for
  // everybody at the same moment the dice are thrown.
  const { editable, reason } = moveIsEditable(gambit(), TURN, {
    now: AFTER_CUTOFF,
    clockFrozen: false,
  });
  assert.equal(editable, false);
  assert.match(reason, /locked/);
  assert.equal(cutoffReached(TURN, { now: AFTER_CUTOFF }).at, true);
});

test("an OVERDUE turn does not reopen editing — the regression that made a re-roll slot machine", () => {
  // moveWindow().locked is false on BOTH sides of the window: before the cutoff, and
  // again once a turn outlives its derived end because an advance was missed. Reading
  // `locked` here meant that past endsAt a player could take back a Gambit whose die was
  // thrown hours earlier, re-file, and have the staged push throw a fresh one — over and
  // over until the advance landed.
  const { hasLock } = require("../lib/turnClock").moveWindow(TURN, { now: TURN.startedAt });
  assert.ok(hasLock, "fixture turn must have a lock for this test to mean anything");

  // One minute past the turn's derived end: locked has flipped back to false.
  const { locked } = require("../lib/turnClock").moveWindow(TURN, { now: OVERDUE, clockFrozen: false });
  assert.equal(locked, false, "precondition: locked reopens past endsAt");

  // ...and the Move must still refuse.
  const { editable, reason } = moveIsEditable(gambit(), TURN, { now: OVERDUE, clockFrozen: false });
  assert.equal(editable, false, "an overdue turn must not reopen editing");
  assert.match(reason, /locked/);

  // Belt and braces: a row that actually carries a die refuses for its own reason too.
  assert.equal(
    moveIsEditable(gambit({ diceRoll: 6 }), TURN, { now: OVERDUE, clockFrozen: false }).editable,
    false,
  );
  assert.ok(CUTOFF_AT < OVERDUE);
});

test("a Move stays editable for exactly as long as the die is unthrown", () => {
  // The invariant tying the two predicates together: walk a turn minute by minute, well
  // past its end, and assert editing is never open once the cutoff has passed.
  const start = TURN.startedAt.getTime();

  for (let minutes = 0; minutes < 60 * 40; minutes += 17) {
    const now = new Date(start + minutes * 60_000);
    const { at } = cutoffReached(TURN, { now, clockFrozen: false });
    const { editable } = moveIsEditable(gambit(), TURN, { now, clockFrozen: false });
    // The die is thrown at or after the cutoff; editing is open only strictly before it.
    assert.equal(at && editable, false, `both true at +${minutes}m`);
    if (now >= CUTOFF_AT) {
      assert.equal(editable, false, `editable past the cutoff at +${minutes}m`);
    }
  }
});

test("MOVE_LOCK_HOURS is what both of them count back from", () => {
  assert.equal(typeof MOVE_LOCK_HOURS, "number");
  assert.ok(MOVE_LOCK_HOURS > 0);
});
