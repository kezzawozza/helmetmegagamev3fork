// "May a player act on the turn right now?" — one answer, one sentence, both faces.
//
// This did not exist, and its absence was a bug waiting to be written. Fourteen call sites each loaded the open turn, called
// clockFrozen(), called moveWindow(), read `.locked`, and hardcoded their own copy of the refusal — in four different
// wordings. Adding Sessions to that shape would have meant a fifteenth copy, and any site somebody forgot would quietly
// accept Moves while the game was shut.
//
// THE ORDER OF THE CHECKS IS THE POINT. `moveWindow().locked` is false when the clock is frozen, on purpose: freezing
// removes the DEADLINE (there is no scheduled end to count back from), it does not shut the game. So a gate that asked only
// about `locked` would read "not in session" as "wide open" — the exact opposite. The session question comes first.

const { moveWindow } = require("./turnClock");
const { clockStatus } = require("./gameState");

// Keyed by the same vocabulary db/lib/gameState.js#frozenReason speaks, plus the two this gate adds of its own.
const GATE_MESSAGES = {
  NO_TURN: "No turn is open.",
  NOT_IN_SESSION: "The game isn't in session.",
  NOT_RUNNING: "The game isn't running.",
  PAUSED: "The turn clock is paused.",
  LOCKED: "Moves are locked for this turn.",
};

function gateMessage(reason) {
  return reason ? (GATE_MESSAGES[reason] ?? GATE_MESSAGES.LOCKED) : null;
}

// Takes the client as a parameter, the db/lib/dm.js convention — `db` may be a transaction, which several callers hand it.
// `turn` is returned whether or not the gate opens, because a refusing caller usually still wants to name the turn.
async function movesOpen(db, { now = new Date(), turn = null } = {}) {
  const [openTurn, status] = await Promise.all([
    turn ? Promise.resolve(turn) : db.turn.findFirst({ where: { status: "OPEN" } }),
    clockStatus(db),
  ]);

  if (!openTurn) return refusal("NO_TURN", null, null);

  // Before the window, always. See the header.
  if (!status.inSession) return refusal("NOT_IN_SESSION", openTurn, null);

  const window = moveWindow(openTurn, { now, clockFrozen: status.frozen });
  if (window.locked) return refusal("LOCKED", openTurn, window);

  return { ok: true, reason: null, message: null, turn: openTurn, window };
}

function refusal(reason, turn, window) {
  return { ok: false, reason, message: gateMessage(reason), turn, window };
}

module.exports = { movesOpen, gateMessage, GATE_MESSAGES };
