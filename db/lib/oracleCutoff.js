// Fires the Oracle when a turn's Move cutoff passes, so a GM reads the chronicle while they adjudicate (docs/systemdocs/ORACLE.md). There is no lock EVENT to hang this on, so this is a per-minute check rather than a subscription — a fixed cron would be wrong for a turn opened by hand, or during a frozen clock.

const { moveWindow } = require("./turnClock");
const { clockFrozen } = require("./gameState");
const { runOracle } = require("./oracle");

// A failing zone costs a 180s timeout plus a retry (oracleClient.js), so a provider outage would otherwise spend the whole window retrying. Three tries and the turn is left to Run now; in-process on purpose, not worth a column.
const MAX_ATTEMPTS = 3;

const attempts = new Map();

function spendAttempt(turnId) {
  for (const key of attempts.keys()) {
    if (key !== turnId) attempts.delete(key);
  }
  const spent = attempts.get(turnId) ?? 0;
  attempts.set(turnId, spent + 1);
  return spent;
}

// Pure, so every branch is testable without a database, a clock or a provider — all but one is a REFUSAL, and a refusal that fires by mistake is silent. Returns a reason rather than a bare false so a log line can say which.
function cutoffDecision(turn, { now = new Date(), clockFrozen = false } = {}) {
  if (!turn) return { draft: false, reason: "no open turn" };

  const { locked, hasLock, cutoffAt } = moveWindow(turn, { now, clockFrozen });

  if (!hasLock) return { draft: false, reason: "this turn never locks" };

  // `locked` is false on BOTH sides: before the cutoff, and again once the turn has outlived its derived end because an advance was missed (turnClock.js) — Run now is the recovery.
  if (!locked) return { draft: false, reason: now < cutoffAt ? "before the cutoff" : "past the turn's end" };

  return { draft: true, reason: "at the cutoff" };
}

async function runOracleAtCutoff(db, { now = new Date() } = {}) {
  const turn = await db.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, startedAt: true },
  });
  if (!turn) return { ran: false };

  const { draft } = cutoffDecision(turn, { now, clockFrozen: await clockFrozen(db) });
  if (!draft) return { ran: false };

  if ((attempts.get(turn.id) ?? 0) >= MAX_ATTEMPTS) return { ran: false };

  // One key per zone, failure logged rather than thrown: one dead zone must not cost the five that would have written fine. A short run leaves the set incomplete, and the next tick redraws it whole (db/lib/oracle.js).
  const step = async (key, fn) => {
    try {
      await fn();
    } catch (err) {
      console.error(`Oracle step "${key}" failed:`, err.message ?? err);
    }
  };

  const before = spendAttempt(turn.id);
  const result = await runOracle(db, { turnId: turn.id, step, skipIfComplete: true });

  // Nothing to do is not an attempt — un-spend it, or a quiet game would burn its three tries finding the set already complete.
  if (!result.ran) attempts.set(turn.id, before);

  return { ...result, turnNumber: turn.number };
}

module.exports = { runOracleAtCutoff, cutoffDecision };
