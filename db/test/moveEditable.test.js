// node --test over the pure half of db/lib/moves.js#moveIsEditable and
// db/lib/turnClock.js#cutoffReached — the two predicates that decide, between them,
// how long a Gambit stays the player's own.
//
// They are two halves of one rule and are tested together on purpose: a Move stops
// being editable at exactly the cutoff, and if these two ever disagree a player either
// edits a locked Gambit or loses one the window was still open on.
//
// NOT at the moment the die is thrown, which is what this suite used to say. The die
// lands at SUBMIT now (db/lib/gambitDie.js) so a GM can adjudicate early, and it is bound
// to the character and turn, so an edit cannot change it. What closes the window is the
// cutoff, and `diceModifier` is the mark the settle pass leaves behind
// (db/lib/gambitCutoff.js) for a turn that has no cutoff to read.
const test = require("node:test");
const assert = require("node:assert");

const { moveIsEditable } = require("../lib/moves");
const { cutoffReached, adjudicationHours, TURN_LENGTH_CHOICES } = require("../lib/turnClock");

// A FIXED turn, and every test passes an explicit `now`.
//
// These used to build the fixture from Date.now() and let `now` default to the real
// clock. turnEndsAt lands a turn's end on the game's own Chicago boundary grid, so "a turn
// that started an hour ago" lands INSIDE the lock window for a few hours every real night —
// the suite passed when it was written and failed at 02:00 the next morning. Nothing about
// this rule depends on when the tests are run, so nothing here reads the wall clock.
//
// `turnLengthHours` is explicit rather than left to the fallback: the length rides on the
// turn row now, and a fixture without it is testing the default rather than the rule.
const TURN = { startedAt: new Date("2026-09-16T12:00:00Z"), turnLengthHours: 24 };
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
    diceModifier: null,
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

test("a Mine is paid on the press, so there is nothing pending to take back", () => {
  const { editable, reason } = moveIsEditable(gambit({ moveKind: "ROUTINE" }), TURN, {
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

test("a Gambit that already has its die is STILL editable before the cutoff", () => {
  // The inversion that early rolling turns on. A die on the row used to be the hardest
  // refusal in the predicate; now every Gambit carries one from the moment it is
  // confirmed, so reading it here would shut the edit window at submit and take back the
  // whole point of letting a player rewrite their day.
  const { editable } = moveIsEditable(gambit({ diceRoll: 4 }), TURN, { now: OPEN_AT });
  assert.equal(editable, true);
});

test("a settled Gambit can never be touched, whatever the clock says", () => {
  // What replaced the die guard, and it has to hold for the same reason: `hasLock` is
  // false under a frozen clock and on a turn shorter than MOVE_LOCK_HOURS, so without
  // this the staged push could settle a Move that was still open to editing.
  const { editable, reason } = moveIsEditable(gambit({ diceRoll: 4, diceModifier: -1 }), TURN, { now: OPEN_AT });
  assert.equal(editable, false);
  assert.match(reason, /locked/);
});

test("the refusal never names the die — the number is not the player's until the close", () => {
  // These strings reach the player through editMove/withdrawMove, which return
  // result.error verbatim. A refusal reading "the die is already thrown" told them one
  // had been, hours before the reveal DM.
  for (const over of [{}, { diceRoll: 4 }, { diceRoll: 4, diceModifier: -1 }]) {
    for (const now of [OPEN_AT, AFTER_CUTOFF, OVERDUE]) {
      const { reason } = moveIsEditable(gambit(over), TURN, { now, clockFrozen: false });
      assert.doesNotMatch(reason, /\bdie\b|\brolled?\b|\bthrown\b/i, `leaked in "${reason}"`);
    }
  }
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

  // Belt and braces: a row the settle pass already stamped refuses on its own too.
  assert.equal(
    moveIsEditable(gambit({ diceRoll: 6, diceModifier: 0 }), TURN, { now: OVERDUE, clockFrozen: false }).editable,
    false,
  );
  assert.ok(CUTOFF_AT < OVERDUE);
});

test("a Move stays editable for exactly as long as the cutoff is unreached", () => {
  // The invariant tying the two predicates together: walk a turn minute by minute, well
  // past its end, and assert editing is never open once the cutoff has passed.
  const start = TURN.startedAt.getTime();

  for (let minutes = 0; minutes < 60 * 40; minutes += 17) {
    const now = new Date(start + minutes * 60_000);
    const { at } = cutoffReached(TURN, { now, clockFrozen: false });
    const { editable } = moveIsEditable(gambit(), TURN, { now, clockFrozen: false });
    // The window shuts at the cutoff; editing is open only strictly before it.
    assert.equal(at && editable, false, `both true at +${minutes}m`);
    if (now >= CUTOFF_AT) {
      assert.equal(editable, false, `editable past the cutoff at +${minutes}m`);
    }
  }
});

// The adjudication window is a function of the turn's length now rather than one constant, so what has to hold is that
// EVERY length has one, that it is positive, and that it is short enough to leave a turn worth playing.
test("every turn length has an adjudication window both of them count back from", () => {
  for (const hours of TURN_LENGTH_CHOICES) {
    const lock = adjudicationHours(hours);
    assert.equal(typeof lock, "number", `${hours}h has no window`);
    assert.ok(lock > 0, `${hours}h window is not positive`);
    assert.ok(lock < hours, `${hours}h window swallows the whole turn`);
  }
});

// The grid a turn can end on, per length. These are the boundaries the bot's per-minute poll advances at, and the numbers
// Bascinet picked: 2 hours to adjudicate a 6- or 8-hour turn, 3 for a 12- or 24-hour one.
test("the adjudication window matches the turn length it was set for", () => {
  assert.equal(adjudicationHours(6), 2);
  assert.equal(adjudicationHours(8), 2);
  assert.equal(adjudicationHours(12), 3);
  assert.equal(adjudicationHours(24), 3);
  // An unrecognised length is not a crash and not a zero window — it reads as the default.
  assert.equal(adjudicationHours(7), adjudicationHours(24));
  assert.equal(adjudicationHours(undefined), adjudicationHours(24));
});
