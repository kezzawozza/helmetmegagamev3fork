// How often a character may do a noisy thing — shout, or talk out of character.
// One limiter for both faces, so the bot and the web can never disagree about
// whether somebody has had enough. Takes `prisma` as a parameter rather than
// requiring db/index.js (the db/lib/dm.js convention).
//
// A LEAKY BUCKET, not a flat cooldown: you get a burst and then it drips back,
// which is kinder than "one every five minutes" for the common case of somebody
// saying three things at once, and firmer for somebody hammering it.
//
// There is no state column. The bucket is replayed from the AuditLog rows the
// action already writes, the same trick the old shout cooldown used
// (db/lib/shout.js) — so it survives a restart, is shared across both faces,
// and adds no schema. The row that IS the record is the row that IS the limit.

// Ten at once, then one back every half minute.
const OOC_CAPACITY = 10;
const OOC_REFILL_MS = 30_000;

// Three at once, then one back every five minutes — the same long-run rate as
// the flat five-minute cooldown this replaced, with a small burst allowed.
const SHOUT_CAPACITY = 3;
const SHOUT_REFILL_MS = 5 * 60_000;

// The whole rule, pure, so db/test/ can cover it with no database.
// `times` are epoch ms, OLDEST FIRST. Returns the bucket level at `now`, where
// one whole token is one send. Below `capacity` means there is room for another.
//
// Replaying from level 0 is exact as long as the caller looks back far enough:
// a full bucket drains in capacity * refillMs, so any level older than that has
// gone to nothing and starting from zero cannot understate the answer.
function bucketLevel(times, { capacity, refillMs, now = Date.now() } = {}) {
  let level = 0;
  let prev = null;
  for (const at of times) {
    if (prev !== null) level = Math.max(0, level - (at - prev) / refillMs);
    level += 1;
    prev = at;
  }
  if (prev !== null) level = Math.max(0, level - (now - prev) / refillMs);
  return Math.min(level, capacity + 1);
}

// Is there room for ONE MORE? The send being asked about is counted, which is
// the whole off-by-one: after `capacity` sends the level sits a hair under
// `capacity` (a moment of drip has already happened), so a bare
// `level < capacity` would wave the eleventh of ten through.
function hasRoom(level, { capacity }) {
  return level + 1 <= capacity;
}

// Seconds until there is room for one more. At least 1 — a refusal that says
// "try again in 0 seconds" is a refusal that reads as a bug.
function waitSeconds(level, { capacity, refillMs }) {
  const over = level + 1 - capacity;
  if (over <= 0) return 0;
  return Math.max(1, Math.ceil((over * refillMs) / 1000));
}

// How far back the replay above has to look to be exact.
function lookbackMs({ capacity, refillMs }) {
  return capacity * refillMs;
}

// The one call sites make. `{ ok: true }` or `{ ok: false, retryAfter }` (seconds).
//
// Reads, never writes: claiming the row stays the caller's job, so it can happen
// after every other gate and before the slow posting loop (db/lib/shout.js).
// A failed read answers `ok` — a database hiccup must not gag somebody.
async function checkSpeechBucket(prisma, { actionType, characterId, capacity, refillMs } = {}) {
  if (!actionType || !characterId) return { ok: true };

  const now = Date.now();
  const rows = await prisma.auditLog
    .findMany({
      where: {
        actionType,
        targetCharacterId: characterId,
        createdAt: { gte: new Date(now - lookbackMs({ capacity, refillMs })) },
      },
      orderBy: { createdAt: "desc" },
      // A full bucket plus a full refill is the most that can land in the
      // lookback window; the spare two are slack, not arithmetic.
      take: capacity * 2 + 2,
      select: { createdAt: true },
    })
    .catch(() => null);
  if (!rows) return { ok: true };

  const times = rows.map((r) => r.createdAt.getTime()).sort((a, b) => a - b);
  const level = bucketLevel(times, { capacity, refillMs, now });
  if (hasRoom(level, { capacity })) return { ok: true };
  return { ok: false, retryAfter: waitSeconds(level, { capacity, refillMs }) };
}

module.exports = {
  OOC_CAPACITY,
  OOC_REFILL_MS,
  SHOUT_CAPACITY,
  SHOUT_REFILL_MS,
  bucketLevel,
  hasRoom,
  waitSeconds,
  lookbackMs,
  checkSpeechBucket,
};
