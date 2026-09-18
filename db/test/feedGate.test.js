// The two rules the SSE feed's gate is made of (web/app/api/feed/route.js
// #sendRow): what counts as already sent, and what counts as below the wipe
// line. Was once one `lastSeq` high-water mark — a row arriving a moment out
// of order sat below the mark and was dropped for good.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeSeenSeqs } = require("../lib/seenSeqs");
const { floorForPlace } = require("../lib/feedWipe");

test("a seq is remembered once it has been sent", () => {
  const seen = makeSeenSeqs();
  assert.equal(seen.has("1505"), false);
  seen.add("1505");
  assert.equal(seen.has("1505"), true);
});

test("a LOWER seq arriving after a higher one is still new", () => {
  const seen = makeSeenSeqs();
  seen.add("1506");
  assert.equal(seen.has("1505"), false);
});

test("nothing is forgotten before the generation fills", () => {
  const seen = makeSeenSeqs(4);
  for (const k of ["1", "2", "3"]) seen.add(k);
  for (const k of ["1", "2", "3"]) assert.equal(seen.has(k), true);
});

test("a full generation is kept as the spare, not dropped", () => {
  const seen = makeSeenSeqs(2);
  seen.add("1");
  seen.add("2"); // flips: live -> spare
  assert.equal(seen.has("1"), true, "the flipped generation is still readable");
  assert.equal(seen.has("2"), true);
});

test("memory is bounded — the oldest generation is let go on the second flip", () => {
  const seen = makeSeenSeqs(2);
  seen.add("1");
  seen.add("2"); // flip one
  seen.add("3");
  seen.add("4"); // flip two: the generation holding 1 and 2 is gone
  assert.equal(seen.has("1"), false);
  assert.equal(seen.has("4"), true);
  assert.ok(seen.size <= 4, "never more than two generations of `max`");
});

test("a re-sent row is not counted twice", () => {
  const seen = makeSeenSeqs();
  seen.add("1505");
  seen.add("1505");
  assert.equal(seen.size, 1);
});

test("makeSeenSeqs refuses a nonsense bound", () => {
  assert.throws(() => makeSeenSeqs(0), TypeError);
  assert.throws(() => makeSeenSeqs(1.5), TypeError);
});

// A zone summary wipes on the slower once-a-day schedule, so its rows are older
// than the turn floor — the gate asks per place, not the lower of the two.
test("a zone summary is measured against the summary floor", () => {
  const floors = { turn: 100n, summary: 10n };
  assert.equal(floorForPlace(floors, "zone:abc"), 10n);
});

test("a room, a location and a conversation are measured against the turn floor", () => {
  const floors = { turn: 100n, summary: 10n };
  for (const key of ["room:abc", "loc:abc", "conv:abc"]) {
    assert.equal(floorForPlace(floors, key), 100n);
  }
});

test("a summary row between the two floors survives, and a room row does not", () => {
  const floors = { turn: 100n, summary: 10n };
  const passes = (seq, placeKey) => seq > floorForPlace(floors, placeKey);
  assert.equal(passes(50n, "zone:abc"), true, "above its own summary floor");
  assert.equal(passes(50n, "room:abc"), false, "below the turn floor it was wiped by");
});
