// Runs an op list, one op at a time.
//
// Two rules, and both of them are about not getting the bot IP-banned.
//
// SEQUENTIAL, NEVER Promise.all. A fan-out across a hundred channels is how a
// bot spends a rate-limit bucket in one breath; every other Discord walk in
// this codebase (broadcastIntercom, the doctor's sweeps, the zone sync) is a
// plain for...of for the same reason, and so is this.
//
// AN OP THAT THROWS DOES NOT STOP THE RUN. One room's starter failing must not
// cost the fifty behind it — the failure is recorded against that op and the
// walk continues. The one thing that does stop it is the breaker, below.
//
// STOP WHEN THE BREAKER IS OPEN. Cloudflare counts 401/403/429 responses and
// bans a token that emits 10,000 in ten minutes, so discordRest's breaker trips
// at a tenth of that and refuses to send. Pushing the rest of the list into a
// breaker that is already open just burns the cooldown. Everything left is
// marked deferred and reported, so /gm/dev can show a stuck run rather than a
// quietly half-finished one.
const { breakerIsOpen } = require("../discordRest");

async function applyOps(ops, { apply = false, reason = null } = {}) {
  const done = [];
  const deferred = [];
  const failures = [];

  for (const op of ops) {
    const row = { order: op.order, kind: op.kind, targetType: op.targetType, targetId: op.targetId, reason: op.reason };

    if (!apply) {
      row.status = "would-run";
      done.push(row);
      continue;
    }
    if (breakerIsOpen()) {
      row.status = "deferred";
      row.detail = "the Discord circuit breaker is open";
      deferred.push(row);
      continue;
    }
    if (typeof op.run !== "function") {
      // An op the diff could describe but not carry out — a thread whose row
      // never reached the diff, say. Recorded rather than swallowed, so it
      // shows up on /gm/dev as work that did not happen.
      row.status = "skipped";
      row.detail = reason ?? "no runnable step attached";
      done.push(row);
      continue;
    }

    try {
      await op.run();
      row.status = "ran";
      done.push(row);
    } catch (err) {
      row.status = "failed";
      row.detail = err?.message ?? String(err);
      failures.push({ check: `mirror-${op.kind}`, target: op.targetId, message: row.detail });
      done.push(row);
    }
  }

  return { ran: done, deferred, failures };
}

module.exports = { applyOps };
