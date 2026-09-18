// Fires the Oracle when a turn's Move cutoff passes, so a GM reads the chronicle while they adjudicate (docs/systemdocs/ORACLE.md). There is no lock EVENT to hang this on, so this is a per-minute check rather than a subscription — a fixed cron would be wrong for a turn opened by hand, or during a frozen clock.
// Two-phase now (ORACLE.md §2): phase one drafts five minutes early, over
// everything already knowable; phase two runs at the cutoff itself, once the
// Moves are in, and appends "Declared this turn" / "Needs a ruling".

const { cutoffReached, moveWindow, TURN_CLOCK_SELECT } = require("./turnClock");
const { clockFrozen } = require("./gameState");
const { runOracle } = require("./oracle");

// Phase one runs five minutes early over everything already knowable — last
// turn's resolved rows, the rulings, the chat sample, the memory — so that at
// the lock only the Moves are left to write. Nothing filed in the last five
// minutes is lost, because phase two reads the Moves at the cutoff itself.
const PHASE_ONE_LEAD_MS = 5 * 60 * 1000;

// A failing zone costs a 300s timeout plus a retry (oracleClient.js), so a provider outage would otherwise spend the whole window retrying. Three tries and the turn is left to Run now; in-process on purpose, not worth a column. Per turn PER PHASE now, since the two phases fail for different reasons at different times.
const MAX_ATTEMPTS = 3;

// Keyed `${turnId}:${phase}` so phase one and phase two spend their own
// budget — a phase one that used all three tries must not stop phase two from
// even trying.
const attempts = new Map();

function attemptKey(turnId, phase) {
  return `${turnId}:${phase}`;
}

function spendAttempt(turnId, phase) {
  const prefix = `${turnId}:`;
  for (const key of attempts.keys()) {
    if (!key.startsWith(prefix)) attempts.delete(key);
  }
  const key = attemptKey(turnId, phase);
  const spent = attempts.get(key) ?? 0;
  attempts.set(key, spent + 1);
  return spent;
}

// The cutoff test itself lives in turnClock.js#cutoffReached, shared with
// db/lib/gambitCutoff.js — the Oracle and the Gambit dice both fire on the
// same moment and must never disagree about when it is. This wrapper adds the
// one thing that is the Oracle's alone: a five-minute lead window before the
// cutoff, when phase one may draft. Do NOT fold the lead window into
// cutoffReached/moveWindow — gambitCutoff.js shares those and has no phase
// one to run early.
function cutoffDecision(turn, { now = new Date(), clockFrozen = false } = {}) {
  const { at, reason } = cutoffReached(turn, { now, clockFrozen });
  if (at) return { draft: true, phase: 2, reason };

  const { hasLock, cutoffAt } = moveWindow(turn, { now, clockFrozen });
  if (hasLock && cutoffAt && now.getTime() >= cutoffAt.getTime() - PHASE_ONE_LEAD_MS && now.getTime() < cutoffAt.getTime()) {
    return { draft: true, phase: 1, reason: "five minutes before the cutoff" };
  }

  return { draft: false, phase: null, reason };
}

async function runOracleAtCutoff(db, { now = new Date() } = {}) {
  const turn = await db.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, ...TURN_CLOCK_SELECT },
  });
  if (!turn) return { ran: false };

  const { draft, phase } = cutoffDecision(turn, { now, clockFrozen: await clockFrozen(db) });
  if (!draft) return { ran: false };

  if ((attempts.get(attemptKey(turn.id, phase)) ?? 0) >= MAX_ATTEMPTS) return { ran: false };

  // One key per zone, failure logged rather than thrown: one dead zone must not cost the five that would have written fine. A short run leaves the set incomplete, and the next tick redraws it whole (db/lib/oracle.js).
  const step = async (key, fn) => {
    try {
      await fn();
    } catch (err) {
      console.error(`Oracle step "${key}" failed:`, err.message ?? err);
    }
  };

  const before = spendAttempt(turn.id, phase);
  const result = await runOracle(db, {
    turnId: turn.id,
    step,
    skipIfComplete: true,
    phases: phase === 1 ? "one" : "two",
  });

  // Nothing to do is not an attempt — un-spend it, or a quiet game would burn
  // its three tries finding the set already complete. A THROWING run is the
  // opposite: `failed` (db/lib/oracle.js's catch) is left spent on purpose, or
  // a provider that errors every time would retry once a minute for the whole
  // three-hour window instead of giving up after MAX_ATTEMPTS.
  if (!result.ran && !result.failed) attempts.set(attemptKey(turn.id, phase), before);

  return { ...result, phase: result.phase ?? phase, turnNumber: turn.number };
}

module.exports = { runOracleAtCutoff, cutoffDecision };
