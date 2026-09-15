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
const { runDiscordMirror } = require("./index");
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
async function drainMirrorQueue(prisma, { max = 50 } = {}) {
  if (breakerIsOpen()) return { drained: 0, jobs: 0, skipped: "the Discord circuit breaker is open" };

  let jobs;
  try {
    jobs = await pendingMirrorJobs(prisma, { max });
  } catch (err) {
    console.error("drainMirrorQueue: could not read the queue:", err?.message ?? err);
    return { drained: 0, jobs: 0, error: err?.message ?? String(err) };
  }
  if (jobs.length === 0) return { drained: 0, jobs: 0 };

  const startedAt = new Date();
  await prisma.mirrorJob
    .updateMany({ where: { id: { in: jobs.map((j) => j.id) } }, data: { startedAt } })
    .catch(() => {});

  let result;
  try {
    result = await runDiscordMirror(prisma, {
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
  const trouble = [...result.failures, ...result.deferred].length > 0;
  if (trouble) {
    const why =
      result.deferred.length > 0
        ? "the Discord circuit breaker is open"
        : result.failures[0]?.message ?? "an op failed";
    await bumpAll(prisma, jobs, why);
    return { drained: 0, jobs: jobs.length, retrying: jobs.length, error: why };
  }

  await prisma.mirrorJob
    .deleteMany({ where: { id: { in: jobs.map((j) => j.id) } } })
    .catch((err) => console.error("drainMirrorQueue: could not clear finished jobs:", err?.message ?? err));

  return { drained: jobs.length, jobs: jobs.length, ops: result.ops.length };
}

async function bumpAll(prisma, jobs, error) {
  const finished = new Date();
  for (const job of jobs) {
    const attempts = job.attempts + 1;
    await prisma.mirrorJob
      .update({
        where: { id: job.id },
        data: {
          attempts,
          error: String(error ?? "").slice(0, 500),
          // At the cap the job stops being pending and starts being a report.
          finishedAt: attempts >= MAX_ATTEMPTS ? finished : null,
        },
      })
      .catch(() => {});
  }
}

// What /gm/dev shows: how much is waiting, and how much of it is stuck.
async function mirrorQueueStatus(prisma) {
  const [pending, retried, givenUp] = await Promise.all([
    prisma.mirrorJob.count({ where: { finishedAt: null } }),
    prisma.mirrorJob.count({ where: { finishedAt: null, attempts: { gt: 1 } } }),
    prisma.mirrorJob.count({ where: { attempts: { gte: MAX_ATTEMPTS } } }),
  ]);
  return { pending, retried, givenUp, breakerOpen: breakerIsOpen() };
}

module.exports = { enqueueMirror, drainMirrorQueue, mirrorQueueStatus, pendingMirrorJobs, MAX_ATTEMPTS };
