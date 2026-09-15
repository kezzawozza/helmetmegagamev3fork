// The mirror's work queue — the claim, and the two ways a row must survive a
// drain that does not finish it cleanly: a save landing mid-run, and a pass
// whose only trouble was the circuit breaker.
//
// `runDiscordMirror` is stubbed on db/lib/discordMirror/index's own exports
// object, not destructured — queue.js requires that module WHOLE for exactly
// this reason (see its own header comment), so reassigning the property here
// reaches the call inside drainMirrorQueue.
const test = require("node:test");
const assert = require("node:assert/strict");

const discordMirrorIndex = require("../lib/discordMirror/index");
const { drainMirrorQueue, enqueueMirror, MAX_ATTEMPTS } = require("../lib/discordMirror/queue");

// --- a tiny in-memory MirrorJob table -----------------------------------

function matchesWhere(row, where = {}) {
  if (where.OR) return where.OR.some((w) => matchesWhere(row, w));
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") continue;
    if (key === "NOT") {
      if (matchesWhere(row, cond)) return false;
      continue;
    }
    const val = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond && !cond.in.map(String).includes(String(val))) return false;
      if ("lt" in cond && !(val < cond.lt)) return false;
      if ("lte" in cond && !(val <= cond.lte)) return false;
      if ("gt" in cond && !(val > cond.gt)) return false;
      if ("gte" in cond && !(val >= cond.gte)) return false;
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}

function fakeQueuePrisma(initial = []) {
  let rows = initial.map((r) => ({ attempts: 0, error: null, startedAt: null, finishedAt: null, ...r }));
  let seq = 0;
  return {
    mirrorJob: {
      async findMany({ where, orderBy, take } = {}) {
        let out = rows.filter((r) => matchesWhere(r, where));
        if (orderBy?.enqueuedAt === "asc") out = [...out].sort((a, b) => a.enqueuedAt - b.enqueuedAt);
        if (take) out = out.slice(0, take);
        return out.map((r) => ({ ...r }));
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const r of rows) {
          if (matchesWhere(r, where)) {
            Object.assign(r, data);
            count += 1;
          }
        }
        return { count };
      },
      async update({ where, data }) {
        const row = rows.find((r) => r.id === where.id);
        assert.ok(row, `no such job ${where.id}`);
        Object.assign(row, data);
        return { ...row };
      },
      async deleteMany({ where }) {
        const before = rows.length;
        rows = rows.filter((r) => !matchesWhere(r, where));
        return { count: before - rows.length };
      },
      async upsert({ where, update, create }) {
        const key = where.targetType_targetId;
        let row = rows.find((r) => r.targetType === key.targetType && r.targetId === key.targetId);
        if (row) {
          Object.assign(row, update);
          return { ...row };
        }
        row = { id: `job-${++seq}`, attempts: 0, error: null, startedAt: null, finishedAt: null, enqueuedAt: new Date(), ...create };
        rows.push(row);
        return { ...row };
      },
      async count({ where }) {
        return rows.filter((r) => matchesWhere(r, where)).length;
      },
    },
  };
}

function stubMirror(fn) {
  const original = discordMirrorIndex.runDiscordMirror;
  discordMirrorIndex.runDiscordMirror = fn;
  return () => {
    discordMirrorIndex.runDiscordMirror = original;
  };
}

// --- the tests -----------------------------------------------------------

test("a concurrent second drain claims nothing", async () => {
  const prisma = fakeQueuePrisma([
    { id: "j1", targetType: "location", targetId: "l1", reason: "save", enqueuedAt: new Date(2020, 0, 1) },
  ]);
  let runs = 0;
  const restore = stubMirror(async () => {
    runs += 1;
    return { ops: [1], failures: [], deferred: [] };
  });
  try {
    const [a, b] = await Promise.all([drainMirrorQueue(prisma), drainMirrorQueue(prisma)]);
    assert.equal(runs, 1, "only one of the two racing drains may actually run the mirror");
    const byDrained = [a, b].sort((x, y) => y.drained - x.drained);
    assert.equal(byDrained[0].drained, 1, "the winner drains the job");
    assert.equal(byDrained[1].drained, 0, "the loser claims nothing");
    assert.equal(byDrained[1].jobs, 0);
  } finally {
    restore();
  }
});

test("a save that lands mid-run re-enqueues and survives the delete", async () => {
  const prisma = fakeQueuePrisma([
    { id: "j1", targetType: "location", targetId: "l1", reason: "save 1", enqueuedAt: new Date(Date.now() - 1000) },
  ]);
  const restore = stubMirror(async () => {
    // A second save on the same Location, landing WHILE this pass is running —
    // enqueueMirror's own upsert bumps enqueuedAt and clears startedAt. The
    // short wait is only so its `new Date()` reads later than the clock tick
    // `drainMirrorQueue` already captured as `startedAt`, not a real race.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await enqueueMirror(prisma, "location", "l1", "save 2");
    return { ops: [1], failures: [], deferred: [] };
  });
  try {
    const result = await drainMirrorQueue(prisma);
    assert.equal(result.drained, 1, "the pass itself still reports success");
    const remaining = await prisma.mirrorJob.findMany({ where: {} });
    assert.equal(remaining.length, 1, "the re-enqueued job must not be deleted out from under the new save");
    assert.equal(remaining[0].reason, "save 2");
    assert.equal(remaining[0].finishedAt, null);
    assert.equal(remaining[0].startedAt, null, "cleared, so the next drain can claim it");
  } finally {
    restore();
  }
});

test("a deferred-only pass leaves attempts unchanged and clears the claim", async () => {
  const prisma = fakeQueuePrisma([
    { id: "j1", targetType: "location", targetId: "l1", reason: "save", enqueuedAt: new Date() },
  ]);
  const restore = stubMirror(async () => ({
    ops: [],
    failures: [],
    deferred: [{ order: 1, kind: "create", targetType: "channel", targetId: "x" }],
  }));
  try {
    const result = await drainMirrorQueue(prisma);
    assert.equal(result.drained, 0);
    assert.match(result.error, /circuit breaker/);
    const [job] = await prisma.mirrorJob.findMany({ where: {} });
    assert.equal(job.attempts, 0, "a breaker-only pass is not the job's fault — it must not spend an attempt");
    assert.equal(job.startedAt, null, "cleared so a later drain can claim it again");
    assert.ok(job.error, "still recorded, so /gm/dev shows why it is waiting");
    assert.ok(job.finishedAt === null && job.attempts < MAX_ATTEMPTS, "never given up on for a breaker pass alone");
  } finally {
    restore();
  }
});

test("a real failure bumps attempts and still clears the claim", async () => {
  const prisma = fakeQueuePrisma([
    { id: "j1", targetType: "location", targetId: "l1", reason: "save", enqueuedAt: new Date() },
  ]);
  const restore = stubMirror(async () => ({
    ops: [],
    failures: [{ check: "mirror-create", target: "x", message: "Discord said no" }],
    deferred: [],
  }));
  try {
    const result = await drainMirrorQueue(prisma);
    assert.equal(result.drained, 0);
    assert.match(result.error, /Discord said no/);
    const [job] = await prisma.mirrorJob.findMany({ where: {} });
    assert.equal(job.attempts, 1, "a real op failure does spend an attempt");
    assert.equal(job.startedAt, null, "cleared so it can be claimed again on the next try");
  } finally {
    restore();
  }
});
