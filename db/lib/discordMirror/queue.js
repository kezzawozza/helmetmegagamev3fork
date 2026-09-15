// The mirror's work queue.
//
// The pattern it generalizes is the one quest rooms already use: write the row,
// return, and let Discord catch up. A GM saving a Location should not sit
// through a channel create, a reparent and a pinned anchor before the page
// comes back — and if Discord is down, their edit should still land.
//
// So a writer calls `enqueueMirror` and is done. The drain runs the mirror
// scoped to the pending jobs. The web `after()` is the primary trigger, because
// the web app is the half that is always up; the bot's ready pass and the turn
// wrapup are the backstop for anything a web request never came back for.
//
// A job is deleted only when its ops all succeeded. Otherwise `attempts` goes
// up and `error` records why, and at MAX_ATTEMPTS the mirror stops trying and
// leaves the row where /gm/dev can show it. A job that retries forever behind an
// open circuit breaker is a silently stale world, which is the thing this whole
// phase is meant to stop.
// Lazy/whole-module require, not a destructure, so a test can stand in for
// runDiscordMirror the same way apply.js's thunks stand in for discordRest.
const discordMirrorIndex = require("./index");
const { breakerIsOpen } = require("../discordRest");

const MAX_ATTEMPTS = 5;

// Upsert, so ten saves of one Location are one job. `finishedAt` is cleared on
// the way in: a place that has changed again since the last drain is pending
// again, whatever happened last time.
async function enqueueMirror(prisma, targetType, targetId, reason) {
  if (!targetType || !targetId) return null;
  const where = { targetType_targetId: { targetType: String(targetType), targetId: String(targetId) } };
  return prisma.mirrorJob
    .upsert({
      where,
      update: { reason: String(reason ?? ""), enqueuedAt: new Date(), finishedAt: null, startedAt: null },
      create: { targetType: String(targetType), targetId: String(targetId), reason: String(reason ?? "") },
    })
    .catch((err) => {
      // Never fail the caller's write for a queue row. The bot's backstop drain
      // and the next save both cover a job that was never written.
      console.error("enqueueMirror failed:", err?.message ?? err);
      return null;
    });
}

async function pendingMirrorJobs(prisma, { max = 50 } = {}) {
  return prisma.mirrorJob.findMany({
    where: { finishedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { enqueuedAt: "asc" },
    take: max,
  });
}

// Runs one mirror pass over everything pending and settles the rows behind it.
// Returns what happened, so a caller can log it; it never throws.
//
// CLAIM before running. `pendingMirrorJobs` only lists candidates — two drains
// racing (the bot's ready pass and a web request landing at the same moment)
// would otherwise both read the same rows and run the same mirror pass twice.
// The claim is the `updateMany` below: it flips `startedAt` from null to now
// for exactly the rows nobody else has already claimed, and only those rows
// are re-read and acted on. A job left claimed forever would never drain
// again, so every exit past this point — success, failure, or the circuit
// breaker — clears `startedAt` back to null.
async function drainMirrorQueue(prisma, { max = 50 } = {}) {
  if (breakerIsOpen()) return { drained: 0, jobs: 0, skipped: "the Discord circuit breaker is open" };

  let candidates;
  try {
    candidates = await pendingMirrorJobs(prisma, { max });
  } catch (err) {
    console.error("drainMirrorQueue: could not read the queue:", err?.message ?? err);
    return { drained: 0, jobs: 0, error: err?.message ?? String(err) };
  }
  if (candidates.length === 0) return { drained: 0, jobs: 0 };

  const startedAt = new Date();
  const ids = candidates.map((j) => j.id);
  let jobs;
  try {
    const { count } = await prisma.mirrorJob.updateMany({
      where: { id: { in: ids }, startedAt: null },
      data: { startedAt },
    });
    if (count === 0) return { drained: 0, jobs: 0 };
    jobs = await prisma.mirrorJob.findMany({ where: { id: { in: ids }, startedAt } });
  } catch (err) {
    console.error("drainMirrorQueue: could not claim the queue:", err?.message ?? err);
    return { drained: 0, jobs: 0, error: err?.message ?? String(err) };
  }
  if (jobs.length === 0) return { drained: 0, jobs: 0 };

  let result;
  try {
    result = await discordMirrorIndex.runDiscordMirror(prisma, {
      apply: true,
      scope: "structure",
      targets: jobs.map((j) => ({ targetType: j.targetType, targetId: j.targetId })),
    });
  } catch (err) {
    await bumpAll(prisma, jobs, err?.message ?? String(err));
    return { drained: 0, jobs: jobs.length, error: err?.message ?? String(err) };
  }

  // One failure anywhere in the pass leaves every job in it pending. The op
  // list does not say which job an op belongs to, and re-running a clean job is
  // free — the mirror is idempotent, which is the property the whole design
  // rests on. Guessing wrong in the other direction drops work on the floor.
  //
  // A pass whose only trouble is DEFERRED ops (the breaker was open mid-run) is
  // not the job's fault, so it does not spend an attempt — only a real failure
  // does. Either way `startedAt` is cleared so the next drain can claim it.
  const deferredOnly = result.failures.length === 0 && result.deferred.length > 0;
  const trouble = result.failures.length > 0 || result.deferred.length > 0;
  if (trouble) {
    const why = deferredOnly ? "the Discord circuit breaker is open" : result.failures[0]?.message ?? "an op failed";
    await bumpAll(prisma, jobs, why, { countAttempt: !deferredOnly });
    return { drained: 0, jobs: jobs.length, retrying: jobs.length, error: why };
  }

  // Only the jobs that have not been re-enqueued since they were claimed: a
  // save that landed mid-run bumped `enqueuedAt` past `startedAt` and must
  // survive, pending again for the next drain.
  await prisma.mirrorJob
    .deleteMany({ where: { id: { in: ids }, enqueuedAt: { lte: startedAt } } })
    .catch((err) => console.error("drainMirrorQueue: could not clear finished jobs:", err?.message ?? err));

  return { drained: jobs.length, jobs: jobs.length, ops: result.ops.length };
}

async function bumpAll(prisma, jobs, error, { countAttempt = true } = {}) {
  const finished = new Date();
  for (const job of jobs) {
    const attempts = countAttempt ? job.attempts + 1 : job.attempts;
    await prisma.mirrorJob
      .update({
        where: { id: job.id },
        data: {
          attempts,
          error: String(error ?? "").slice(0, 500),
          // Cleared so a later drain can claim the row again — only the
          // MAX_ATTEMPTS cap below stops it being retried, never a stuck flag.
          startedAt: null,
          // At the cap the job stops being pending and starts being a report.
          finishedAt: countAttempt && attempts >= MAX_ATTEMPTS ? finished : null,
        },
      })
      .catch(() => {});
  }
}

// What /gm/dev shows: how much is waiting, how much of it is stuck, and which
// rows those are — a GM staring at "3 retrying" cannot tell what to go look at
// without them.
async function mirrorQueueStatus(prisma) {
  const [pending, retried, givenUp, jobs] = await Promise.all([
    prisma.mirrorJob.count({ where: { finishedAt: null } }),
    prisma.mirrorJob.count({ where: { finishedAt: null, attempts: { gt: 1 } } }),
    prisma.mirrorJob.count({ where: { attempts: { gte: MAX_ATTEMPTS } } }),
    prisma.mirrorJob.findMany({
      where: { OR: [{ attempts: { gt: 1 } }, { NOT: { error: null } }] },
      orderBy: { enqueuedAt: "asc" },
      take: 20,
      select: { targetType: true, targetId: true, attempts: true, error: true },
    }),
  ]);
  return { pending, retried, givenUp, breakerOpen: breakerIsOpen(), jobs };
}

module.exports = { enqueueMirror, drainMirrorQueue, mirrorQueueStatus, pendingMirrorJobs, MAX_ATTEMPTS };
