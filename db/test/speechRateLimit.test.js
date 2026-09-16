// The leaky bucket behind /shout and /ooc (db/lib/speechRateLimit.js). The
// arithmetic is split out of the database read precisely so it can be pinned
// here: a limiter that is a little bit wrong is a limiter that gags somebody
// mid-scene, and nobody finds out until they say so.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  bucketLevel,
  hasRoom,
  waitSeconds,
  lookbackMs,
  OOC_CAPACITY,
  OOC_REFILL_MS,
  SHOUT_CAPACITY,
  SHOUT_REFILL_MS,
} = require("../lib/speechRateLimit");

const OOC = { capacity: OOC_CAPACITY, refillMs: OOC_REFILL_MS };

test("an empty log is an empty bucket", () => {
  assert.equal(bucketLevel([], { ...OOC, now: 1_000_000 }), 0);
});

// n sends, one millisecond apart, ending now.
function burst(n, now) {
  return Array.from({ length: n }, (_, i) => now - (n - i));
}

test("ten at once are allowed and the eleventh is refused", () => {
  const now = 1_000_000;
  // The tenth send is asked about when nine have landed.
  assert.ok(hasRoom(bucketLevel(burst(OOC_CAPACITY - 1, now), { ...OOC, now }), OOC));
  // The eleventh is asked about when ten have.
  assert.equal(hasRoom(bucketLevel(burst(OOC_CAPACITY, now), { ...OOC, now }), OOC), false);
});

test("shout allows its burst and refuses the one after", () => {
  const now = 1_000_000;
  const S = { capacity: SHOUT_CAPACITY, refillMs: SHOUT_REFILL_MS };
  assert.ok(hasRoom(bucketLevel(burst(SHOUT_CAPACITY - 1, now), { ...S, now }), S));
  assert.equal(hasRoom(bucketLevel(burst(SHOUT_CAPACITY, now), { ...S, now }), S), false);
});

test("one refill period later there is room for exactly one more", () => {
  const start = 1_000_000;
  const times = burst(OOC_CAPACITY, start);
  const now = start + OOC_REFILL_MS;
  const level = bucketLevel(times, { ...OOC, now });
  assert.ok(hasRoom(level, OOC), `expected room after one refill, got ${level}`);
  // ...and not room for two: adding that one send fills it again.
  assert.equal(hasRoom(level + 1, OOC), false, `drained too fast: ${level}`);
});

test("it drains to nothing, never below", () => {
  const start = 1_000_000;
  const times = burst(OOC_CAPACITY, start);
  const now = start + OOC_REFILL_MS * OOC_CAPACITY * 10;
  assert.equal(bucketLevel(times, { ...OOC, now }), 0);
});

test("spread out, it never fills", () => {
  const now = 1_000_000_000;
  // One every refill period, twice as many sends as the bucket holds.
  const times = Array.from(
    { length: OOC_CAPACITY * 2 },
    (_, i) => now - (OOC_CAPACITY * 2 - i) * OOC_REFILL_MS,
  );
  assert.ok(hasRoom(bucketLevel(times, { ...OOC, now }), OOC));
});

test("the wait is a whole positive number of seconds, or nothing", () => {
  assert.equal(waitSeconds(OOC_CAPACITY - 1, OOC), 0);
  const wait = waitSeconds(OOC_CAPACITY, OOC);
  assert.ok(Number.isInteger(wait) && wait >= 1, `got ${wait}`);
  // A bucket a hair under the brim still says "wait", not "wait zero seconds".
  assert.ok(waitSeconds(OOC_CAPACITY - 0.0001, OOC) >= 1);
});

test("the lookback is long enough to drain a full bucket", () => {
  for (const opts of [OOC, { capacity: SHOUT_CAPACITY, refillMs: SHOUT_REFILL_MS }]) {
    const back = lookbackMs(opts);
    // Anything older than this has refilled past capacity and contributes zero,
    // which is what makes replaying from level 0 exact rather than generous.
    assert.ok(back / opts.refillMs >= opts.capacity);
  }
});

test("shout keeps its old long-run rate", () => {
  // Three at once, then one every five minutes — the average the flat
  // five-minute cooldown used to enforce.
  assert.equal(SHOUT_REFILL_MS, 5 * 60_000);
  assert.ok(SHOUT_CAPACITY >= 1);
});
