// Fires the Oracle when a turn's Move cutoff passes, so a GM reads the chronicle while they adjudicate (docs/systemdocs/ORACLE.md). There is no lock EVENT to hang this on, so this is a per-minute check rather than a subscription — a fixed cron would be wrong for a turn opened by hand, or during a frozen clock.

const { cutoffReached } = require("./turnClock");
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

// The cutoff test itself now lives in turnClock.js#cutoffReached, shared with db/lib/gambitCutoff.js — the Oracle and the Gambit dice both fire on the same moment and must never disagree about when it is. Kept as a named wrapper so callers and log lines still read in the Oracle's own words.
function cutoffDecision(turn, { now = new Date(), clockFrozen = false } = {}) {
  const { at, reason } = cutoffReached(turn, { now, clockFrozen });
  return { draft: at, reason };
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
