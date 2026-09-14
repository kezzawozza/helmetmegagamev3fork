// Which uploaded portraits are still waiting on a GM — the only thing behind
// the "may be approved or denied" note on the Browse control (PORTRAITS.md
// §1a). A predicate that's too narrow shows an EMPTY queue, not an error.
const test = require("node:test");
const assert = require("node:assert/strict");
const { avatarNeedsReview, avatarReviewWhere } = require("../lib/avatarReview");

const BYTES = Buffer.from([1, 2, 3]);
const EARLY = new Date("2026-09-01T00:00:00Z");
const LATE = new Date("2026-09-02T00:00:00Z");

function character(over = {}) {
  return { avatarData: BYTES, portrait: null, avatarSetAt: EARLY, avatarReviewedAt: null, ...over };
}

test("a fresh upload nobody has looked at is waiting", () => {
  assert.equal(avatarNeedsReview(character()), true);
});

test("a letter plaque is not a picture and is never in the queue", () => {
  assert.equal(avatarNeedsReview(character({ avatarData: null })), false);
});

test("a portrait-maker face is never in the queue", () => {
  assert.equal(avatarNeedsReview(character({ portrait: '{"nose":3}' })), false);
});

test("a kept picture leaves the queue", () => {
  assert.equal(avatarNeedsReview(character({ avatarSetAt: EARLY, avatarReviewedAt: LATE })), false);
});

test("uploading again after a keep brings it back", () => {
  assert.equal(avatarNeedsReview(character({ avatarSetAt: LATE, avatarReviewedAt: EARLY })), true);
});

test("a picture from before the queue existed, with no set stamp, stays out", () => {
  assert.equal(avatarNeedsReview(character({ avatarSetAt: null })), false);
});

test("nothing at all is not waiting", () => {
  assert.equal(avatarNeedsReview(null), false);
  assert.equal(avatarNeedsReview(undefined), false);
});

test("the timestamps compare as dates even when they arrive as strings", () => {
  assert.equal(
    avatarNeedsReview(character({ avatarSetAt: LATE.toISOString(), avatarReviewedAt: EARLY.toISOString() })),
    true,
  );
  assert.equal(
    avatarNeedsReview(character({ avatarSetAt: EARLY.toISOString(), avatarReviewedAt: LATE.toISOString() })),
    false,
  );
});

// ── The Prisma half — asserts the SHAPE of the where, not a run against it ──
const stubPrisma = { character: { fields: { avatarSetAt: Symbol("avatarSetAt") } } };

test("the where keeps both arms — never-reviewed AND reviewed-then-changed", () => {
  const where = avatarReviewWhere(stubPrisma);
  assert.equal(where.portrait, null, "must exclude portrait-maker faces");
  assert.deepEqual(where.avatarData, { not: null });
  assert.deepEqual(where.avatarSetAt, { not: null });

  assert.equal(where.OR.length, 2, "both arms are required");
  assert.ok(
    where.OR.some((arm) => arm.avatarReviewedAt === null),
    "the never-reviewed arm is missing: the queue would come back empty",
  );
  assert.ok(
    where.OR.some((arm) => arm.avatarReviewedAt?.lt === stubPrisma.character.fields.avatarSetAt),
    "the reviewed-then-changed arm must compare against avatarSetAt on the same row",
  );
});
