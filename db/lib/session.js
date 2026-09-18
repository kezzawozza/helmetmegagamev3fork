// Opening and closing a session — the half of GameConfig.gameMode = SESSIONS that writes.
//
// A session is a sitting. Between sittings the whole game is shut: no turn advances, no Move is accepted, and every surface
// says "The game isn't in session." (db/lib/turnGate.js). Sessions sit BESIDE the game lifecycle and never touch
// GameState.phase, which is what lets one game run four of them and still be ended by the ordinary End Game button.
//
// Both halves are driven from the same two functions: the bot's per-minute cron (bot/src/lib/sessionClock.js) when the
// scheduled stamp comes due, and a GM's Start now / Close now on /gm/dev. Neither talks to Discord — the line to post rides
// back for the caller, the returned-side-effects rule every pass in db/ follows (ARCHITECTURE.md).

const { readGameConfig, readGameState } = require("./gameState");
const { nextBoundaryAfter } = require("./turnClock");

// Everything both functions need to decide, in one read.
async function sessionSnapshot(db) {
  const [config, state] = await Promise.all([
    readGameConfig(db, { gameMode: true, turnLengthHours: true }),
    readGameState(db, {
      phase: true,
      sessionOpenedAt: true,
      sessionClosedAt: true,
      sessionScheduledStartAt: true,
      sessionScheduledEndAt: true,
    }),
  ]);
  return { config, state, sessions: config?.gameMode === "SESSIONS" };
}

// Open the session. The open turn's clock RESTARTS from now: a session that opens at 15:00 must not hand players the tail
// end of a turn that has been sitting frozen since Tuesday, and its cutoff would already be in the past. Snapping to the next
// grid boundary (rather than running a full length) keeps the game on clean local times, the same rule a manual advance
// follows.
async function openSession(db, { now = new Date() } = {}) {
  const { state, sessions, config } = await sessionSnapshot(db);
  if (!sessions) return { ok: false, reason: "NOT_SESSIONS" };
  if (state?.sessionOpenedAt) return { ok: false, reason: "ALREADY_OPEN" };

  // Conditional write, so the cron and a GM pressing the button in the same second cannot both open — and only one posts.
  const claimed = await db.gameState.updateMany({
    where: { id: 1, sessionOpenedAt: null },
    data: { sessionOpenedAt: now, sessionClosedAt: null, sessionScheduledStartAt: null },
  });
  if (claimed.count === 0) return { ok: false, reason: "ALREADY_OPEN" };

  const openTurn = await db.turn.findFirst({ where: { status: "OPEN" } });
  if (openTurn) {
    const lengthHours = openTurn.turnLengthHours ?? config?.turnLengthHours ?? 24;
    await db.turn.update({
      where: { id: openTurn.id },
      data: { startedAt: now, endsAt: new Date(nextBoundaryAfter(now.getTime(), lengthHours)) },
    });
  }

  return { ok: true, openedAt: now, line: "The game is in session." };
}

// Close it. The open turn is left exactly as it is — closing a session is not a turn advance, and a sitting that resumes
// tomorrow resumes on the same turn. openSession restamps its clock on the way back in.
async function closeSession(db, { now = new Date() } = {}) {
  const { state, sessions } = await sessionSnapshot(db);
  if (!sessions) return { ok: false, reason: "NOT_SESSIONS" };
  if (!state?.sessionOpenedAt) return { ok: false, reason: "ALREADY_CLOSED" };

  const claimed = await db.gameState.updateMany({
    where: { id: 1, sessionOpenedAt: { not: null } },
    data: { sessionOpenedAt: null, sessionClosedAt: now, sessionScheduledEndAt: null },
  });
  if (claimed.count === 0) return { ok: false, reason: "ALREADY_CLOSED" };

  return { ok: true, closedAt: now, line: "The game is no longer in session." };
}

// What the per-minute cron should do about the schedule, as a word rather than a branch, so it is testable without a clock
// or a database. A game that is not in SESSIONS mode is never due for anything.
function sessionDue(config, state, now = new Date()) {
  if (config?.gameMode !== "SESSIONS") return null;
  const at = (d) => (d ? new Date(d).getTime() : null);
  if (!state?.sessionOpenedAt) {
    const start = at(state?.sessionScheduledStartAt);
    return start != null && now.getTime() >= start ? "OPEN" : null;
  }
  const end = at(state?.sessionScheduledEndAt);
  return end != null && now.getTime() >= end ? "CLOSE" : null;
}

module.exports = { openSession, closeSession, sessionDue, sessionSnapshot };
