// node --test over the Sessions predicates (docs/systemdocs/SESSIONS.md) and the freeze they drive.
//
// The thing under test is not really "does a boolean flip" — it is the trap the whole design is built around: a frozen
// clock makes moveWindow report `locked: false`, because freezing removes the DEADLINE rather than shutting the game. So
// "not in session" has to be its own blocking answer, and these assert that it is.

const test = require("node:test");
const assert = require("node:assert");

const { inSession, isClockRunning, frozenReason } = require("../lib/gameState");
const { sessionDue } = require("../lib/session");
const { gateMessage, GATE_MESSAGES } = require("../lib/turnGate");
const { moveWindow } = require("../lib/turnClock");

const NOW = new Date("2026-09-16T20:00:00Z");
const EARLIER = new Date("2026-09-16T19:00:00Z");
const LATER = new Date("2026-09-16T21:00:00Z");

test("a Persistent game is always in session, whatever the session columns say", () => {
  assert.equal(inSession({ gameMode: "PERSISTENT" }, {}), true);
  assert.equal(inSession({ gameMode: "PERSISTENT" }, { sessionOpenedAt: null }), true);
  // A config that never got the column reads as Persistent, which fails OPEN — the safe direction for a knob nobody set.
  assert.equal(inSession({}, {}), true);
  assert.equal(inSession(null, null), true);
});

test("a Sessions game is in session only while one is open", () => {
  assert.equal(inSession({ gameMode: "SESSIONS" }, { sessionOpenedAt: null }), false);
  assert.equal(inSession({ gameMode: "SESSIONS" }, { sessionOpenedAt: NOW }), true);
  // A scheduled start is not an open session. The cron opens it; until then the game is shut.
  assert.equal(inSession({ gameMode: "SESSIONS" }, { sessionScheduledStartAt: EARLIER }), false);
});

test("the clock runs only when the phase, the pause switch and the session all agree", () => {
  const running = { phase: "RUNNING" };
  for (const phase of ["CLOSED", "LOBBY", "ENDED"]) {
    assert.equal(isClockRunning({}, { phase }), false, `${phase} must not tick`);
    assert.equal(frozenReason({}, { phase }), "NOT_RUNNING");
  }
  assert.equal(isClockRunning({}, running), true);
  assert.equal(frozenReason({}, running), null);
  assert.equal(isClockRunning({ autoTurnAdvanceDisabled: true }, running), false);
  assert.equal(frozenReason({ autoTurnAdvanceDisabled: true }, running), "PAUSED");
  assert.equal(isClockRunning({ gameMode: "SESSIONS" }, running), false);
  assert.equal(frozenReason({ gameMode: "SESSIONS" }, running), "NOT_IN_SESSION");
  assert.equal(isClockRunning({ gameMode: "SESSIONS" }, { ...running, sessionOpenedAt: NOW }), true);
});

test("a game not yet started outranks the session in what the player is told", () => {
  // Both are true; only one is worth saying. "The game isn't in session" to somebody in the lobby is a lie by omission.
  assert.equal(frozenReason({ gameMode: "SESSIONS" }, { phase: "LOBBY" }), "NOT_RUNNING");
});

test("THE TRAP: out of session, moveWindow reports locked FALSE — so the gate must not read it alone", () => {
  const turn = { startedAt: new Date("2026-09-16T17:00:00Z"), turnLengthHours: 6 };
  const frozen = isClockRunning({ gameMode: "SESSIONS" }, { phase: "RUNNING" }) === false;
  assert.equal(frozen, true, "a Sessions game with no session open is frozen");
  const { locked, hasLock } = moveWindow(turn, { now: LATER, clockFrozen: frozen });
  assert.equal(hasLock, false);
  assert.equal(locked, false, "this is the false negative db/lib/turnGate.js exists to catch");
});

test("the scheduler opens on the start stamp and closes on the end stamp, and never in Persistent", () => {
  const sessions = { gameMode: "SESSIONS" };
  assert.equal(sessionDue({ gameMode: "PERSISTENT" }, { sessionScheduledStartAt: EARLIER }, NOW), null);
  assert.equal(sessionDue(sessions, { sessionScheduledStartAt: EARLIER }, NOW), "OPEN");
  assert.equal(sessionDue(sessions, { sessionScheduledStartAt: NOW }, NOW), "OPEN", "due exactly on the minute");
  assert.equal(sessionDue(sessions, { sessionScheduledStartAt: LATER }, NOW), null);
  assert.equal(sessionDue(sessions, { sessionScheduledStartAt: null }, NOW), null, "no schedule, no automatic open");

  // Once open, the start stamp is irrelevant and the end stamp is what matters.
  assert.equal(sessionDue(sessions, { sessionOpenedAt: EARLIER, sessionScheduledEndAt: EARLIER }, NOW), "CLOSE");
  assert.equal(sessionDue(sessions, { sessionOpenedAt: EARLIER, sessionScheduledEndAt: LATER }, NOW), null);
  // A hand-started session with no scheduled end runs until a GM closes it, which is the point of Start now.
  assert.equal(sessionDue(sessions, { sessionOpenedAt: EARLIER }, NOW), null);
});

test("every refusal the gate can give has a sentence, and they are different sentences", () => {
  const reasons = ["NO_TURN", "NOT_IN_SESSION", "NOT_RUNNING", "PAUSED", "LOCKED"];
  for (const r of reasons) {
    assert.equal(typeof gateMessage(r), "string");
    assert.ok(gateMessage(r).length > 0, `${r} has no sentence`);
  }
  assert.equal(new Set(reasons.map(gateMessage)).size, reasons.length, "two refusals share a sentence");
  assert.equal(gateMessage(null), null, "an open gate says nothing");
  assert.equal(GATE_MESSAGES.NOT_IN_SESSION, "The game isn't in session.");
  // An unknown reason must still be a refusal rather than undefined, which would render as an empty error.
  assert.equal(typeof gateMessage("SOMETHING_NEW"), "string");
});
