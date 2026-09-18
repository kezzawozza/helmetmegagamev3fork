// node --test over db/lib/turnClock.js's grid math — the part of this change that everything else stands on.
//
// Pure, so none of this needs a database or a clock. Every case names an explicit instant, for the reason
// moveEditable.test.js gives at length: a fixture built from Date.now() passes when it is written and fails at 02:00 the
// next morning.

const test = require("node:test");
const assert = require("node:assert");

const {
  TURN_LENGTH_CHOICES,
  DEFAULT_TURN_LENGTH_HOURS,
  normalizeTurnLength,
  boundaryHours,
  adjudicationHours,
  nextBoundaryAfter,
  turnEndsAt,
  moveCutoffAt,
  moveWindow,
  advanceDue,
  nextDayNumber,
  isDaylight,
} = require("../lib/turnClock");

// 2026-09-16 is CDT (UTC-5); 2026-01-16 is CST (UTC-6). Both appear below on purpose.
const CDT_NOON = new Date("2026-09-16T17:00:00Z"); // 12:00 Chicago
const CST_NOON = new Date("2026-01-16T18:00:00Z"); // 12:00 Chicago

function turn(startedAt, turnLengthHours, endsAt = null) {
  return { startedAt, turnLengthHours, ...(endsAt ? { endsAt } : {}) };
}

test("only the four offered lengths are accepted; anything else reads as the default", () => {
  for (const h of TURN_LENGTH_CHOICES) assert.equal(normalizeTurnLength(h), h);
  for (const bad of [0, 5, 7, 13, 25, -6, null, undefined, "nonsense", NaN]) {
    assert.equal(normalizeTurnLength(bad), DEFAULT_TURN_LENGTH_HOURS, `${bad} should fall back`);
  }
  // A string that IS one of the four still counts — form values arrive as strings.
  assert.equal(normalizeTurnLength("12"), 12);
});

test("the boundary grid divides the day evenly, always starting at midnight", () => {
  assert.deepEqual(boundaryHours(6), [0, 6, 12, 18]);
  assert.deepEqual(boundaryHours(8), [0, 8, 16]);
  assert.deepEqual(boundaryHours(12), [0, 12]);
  assert.deepEqual(boundaryHours(24), [0]);
  for (const h of TURN_LENGTH_CHOICES) {
    assert.equal(boundaryHours(h).length, 24 / h);
    assert.equal(boundaryHours(h)[0], 0, "every grid starts at midnight");
  }
});

test("a turn ends on the next grid boundary, not a full length after it started", () => {
  // Noon Chicago, which is a boundary on the 6- and 12-hour grids and not on the 8-hour one.
  assert.equal(turnEndsAt(turn(CDT_NOON, 6)).toISOString(), "2026-09-16T23:00:00.000Z"); // 18:00 Chicago
  assert.equal(turnEndsAt(turn(CDT_NOON, 8)).toISOString(), "2026-09-16T21:00:00.000Z"); // 16:00 Chicago
  assert.equal(turnEndsAt(turn(CDT_NOON, 12)).toISOString(), "2026-09-17T05:00:00.000Z"); // 00:00 Chicago
  assert.equal(turnEndsAt(turn(CDT_NOON, 24)).toISOString(), "2026-09-17T05:00:00.000Z");
});

test("a manual advance SNAPS FORWARD, so an off-grid turn is short rather than sliding the grid", () => {
  // 15:37 Chicago on a 6-hour game: the next boundary is 18:00, two hours and change away.
  const odd = new Date("2026-09-16T20:37:00Z");
  assert.equal(turnEndsAt(turn(odd, 6)).toISOString(), "2026-09-16T23:00:00.000Z");
  // And the turn AFTER it is a full six hours, because the grid never moved.
  assert.equal(nextBoundaryAfter(Date.parse("2026-09-16T23:00:00Z"), 6), Date.parse("2026-09-17T05:00:00Z"));
});

test("a stored endsAt wins over the derivation — a mid-game length change cannot move an open turn", () => {
  const pinned = new Date("2027-01-01T00:00:00Z");
  // The row says 6 hours and names its end; the derivation would say 18:00 today.
  assert.equal(turnEndsAt(turn(CDT_NOON, 6, pinned)).getTime(), pinned.getTime());
});

test("the cutoff is the turn's own adjudication window before its end", () => {
  const six = turn(CDT_NOON, 6);
  assert.equal(turnEndsAt(six).getTime() - moveCutoffAt(six).getTime(), 2 * 3600_000);
  const day = turn(CDT_NOON, 24);
  assert.equal(turnEndsAt(day).getTime() - moveCutoffAt(day).getTime(), 3 * 3600_000);
});

test("DST does not shift the grid — a boundary is a local hour on both sides of the change", () => {
  // Winter, CST. The same local hours, six hours off UTC instead of five.
  assert.equal(turnEndsAt(turn(CST_NOON, 6)).toISOString(), "2026-01-17T00:00:00.000Z"); // 18:00 Chicago
  assert.equal(turnEndsAt(turn(CST_NOON, 24)).toISOString(), "2026-01-17T06:00:00.000Z"); // 00:00 Chicago

  // The spring-forward night itself: 2026-03-08, when 02:00 Chicago does not exist. A 6-hour turn opened at 00:30 must
  // still land on 06:00 local, and the SHORT day must not produce a boundary in the past.
  const springNight = new Date("2026-03-08T06:30:00Z"); // 00:30 Chicago, still CST
  const end = turnEndsAt(turn(springNight, 6));
  assert.ok(end > springNight, "a boundary must be strictly after the start");
  // 06:00 Chicago on the far side of the change, which is 11:00Z because the clocks have gone forward to CDT (UTC-5).
  // The boundary is a LOCAL hour, so it arrives five real hours after a 00:30 start rather than five and a half.
  assert.equal(end.toISOString(), "2026-03-08T11:00:00.000Z");
});

test("every length lands every turn on a clean local boundary, all the way round the day", () => {
  for (const hours of TURN_LENGTH_CHOICES) {
    let at = Date.parse("2026-09-16T05:00:00Z"); // 00:00 Chicago
    const grid = new Set(boundaryHours(hours));
    for (let i = 0; i < 24 / hours + 2; i++) {
      at = nextBoundaryAfter(at, hours);
      const localHour = Number(
        new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hourCycle: "h23", hour: "2-digit" }).format(
          new Date(at),
        ),
      );
      assert.ok(grid.has(localHour % 24), `${hours}h grid produced ${localHour}:00`);
    }
  }
});

test("a turn shorter than its own adjudication window never locks at all", () => {
  // 17:30 Chicago on a 6-hour game: half an hour to the boundary, against a 2-hour window.
  const stub = turn(new Date("2026-09-16T22:30:00Z"), 6);
  const { hasLock, locked } = moveWindow(stub, { now: new Date("2026-09-16T22:40:00Z") });
  assert.equal(hasLock, false, "counting back would lock the whole turn the moment it opened");
  assert.equal(locked, false);
});

test("a frozen clock removes the deadline — it does NOT report the game as locked", () => {
  // The trap this whole change is built around: `locked: false` here means "no deadline", not "you may act".
  const six = turn(CDT_NOON, 6);
  const insideTheWindow = new Date("2026-09-16T22:00:00Z"); // 17:00 Chicago, past the 16:00 cutoff
  assert.equal(moveWindow(six, { now: insideTheWindow }).locked, true);
  assert.equal(moveWindow(six, { now: insideTheWindow, clockFrozen: true }).locked, false);
  assert.equal(moveWindow(six, { now: insideTheWindow, clockFrozen: true }).hasLock, false);
});

test("advanceDue fires at the boundary and not before, and stays true if a tick was missed", () => {
  const six = turn(CDT_NOON, 6); // ends 23:00Z
  assert.equal(advanceDue(six, { now: new Date("2026-09-16T22:59:00Z") }), false);
  assert.equal(advanceDue(six, { now: new Date("2026-09-16T23:00:00Z") }), true);
  // Three hours late — the poll must still advance rather than waiting for the next boundary.
  assert.equal(advanceDue(six, { now: new Date("2026-09-17T02:00:00Z") }), true);
});

test("daylight is the real Chicago clock, which is what Sun Sensitivity reads now", () => {
  assert.equal(isDaylight(new Date("2026-09-16T17:00:00Z")), true); // 12:00 Chicago
  assert.equal(isDaylight(new Date("2026-09-16T08:00:00Z")), false); // 03:00 Chicago
  assert.equal(isDaylight(new Date("2026-09-16T11:00:00Z")), true); // 06:00 Chicago, the first lit hour
  assert.equal(isDaylight(new Date("2026-09-16T10:59:00Z")), false); // 05:59
  assert.equal(isDaylight(new Date("2026-09-16T23:00:00Z")), false); // 18:00, the first dark hour
});

test("adjudicationHours is stable for every offered length", () => {
  for (const h of TURN_LENGTH_CHOICES) assert.ok(adjudicationHours(h) > 0 && adjudicationHours(h) < h);
});

test("the day rolls at Chicago midnight, so every length gets the right turns-per-day", () => {
  assert.equal(nextDayNumber(null, CDT_NOON), 1, "the first turn of a game is day 1");

  // A 6-hour game: four turns inside one Chicago day, then the roll.
  let last = { startedAt: new Date("2026-09-16T05:00:00Z"), dayNumber: 3 }; // 00:00 Chicago
  for (const at of ["2026-09-16T11:00:00Z", "2026-09-16T17:00:00Z", "2026-09-16T23:00:00Z"]) {
    assert.equal(nextDayNumber(last, new Date(at)), 3, `${at} is still day 3`);
  }
  assert.equal(nextDayNumber(last, new Date("2026-09-17T05:00:00Z")), 4, "midnight rolls the day");

  // A 24-hour game: one turn per day, so every advance rolls it.
  last = { startedAt: new Date("2026-09-16T05:00:00Z"), dayNumber: 7 };
  assert.equal(nextDayNumber(last, new Date("2026-09-17T05:00:00Z")), 8);
});

test("a manual advance inside a day does not bump the day, and one across midnight does", () => {
  const last = { startedAt: new Date("2026-09-16T17:00:00Z"), dayNumber: 5 }; // 12:00 Chicago
  assert.equal(nextDayNumber(last, new Date("2026-09-16T20:37:00Z")), 5, "15:37 the same day");
  assert.equal(nextDayNumber(last, new Date("2026-09-17T05:30:00Z")), 6, "00:30 the next day");
});

test("changing the turn length mid-game does not renumber the past", () => {
  // The rule reads only the PREVIOUS row's stamped day and the two calendar dates — never the number, never the length.
  // So a game that ran at 24 hours and switches to 6 keeps every day it has already numbered.
  const lastOfTheOldLength = { startedAt: new Date("2026-09-16T05:00:00Z"), dayNumber: 40 };
  assert.equal(nextDayNumber(lastOfTheOldLength, new Date("2026-09-16T11:00:00Z")), 40);
  assert.equal(nextDayNumber(lastOfTheOldLength, new Date("2026-09-17T05:00:00Z")), 41);
});
