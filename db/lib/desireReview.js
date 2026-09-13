// Which fulfilled Desire claims a GM still has to look at, and the shared
// core of revoking one (docs/systemdocs/DESIRES.md §6, §10, and the "GM
// Desires review queue" stage-1 brief).
//
// A player claims a Desire by typing why they earned it; the claim posts the
// points immediately and only afterward waits for a GM to glance at it. That
// asymmetry — pay first, check later — is the same shape avatarReview.js
// uses for uploads, and this module is built the same way: a pure predicate
// for "does this belong in the queue", a Prisma `where` that says the same
// thing, and the two kept in sync by hand because nothing enforces that for
// you.
//
// Zero requires of db/index.js — same reason as db/lib/dm.js: requiring
// db/index.js back from inside db/lib resolves to a partial exports object,
// so every export here takes `prisma` (or a transaction client) as a
// parameter instead.

// A refusal this module raises on purpose, as opposed to anything Prisma or
// a bug throws on the way past. The caller recasts ONLY this into its own
// user-facing error type — a blanket catch would hand a GM the text of a
// connection failure as though it were a rule, which is exactly what Next's
// production redaction is there to stop.
class DesireRevokeRefused extends Error {}

// A claim is waiting when it is a FULFILLED, catalog-backed Desire with no
// review stamp yet. Pure, and the twin of `desireReviewWhere` below — one of
// them runs in a test and the other in Postgres, and they have to agree.
//
// GM free-text awards (revokeDesireGmImpl's sibling, the Dev Panel "fulfill"
// action) have templateId null and must NEVER enter this queue — a GM who
// just typed the points in by hand has nothing to review.
function desireNeedsReview(desire) {
  if (!desire) return false;
  if (desire.status !== "FULFILLED") return false;
  if (!desire.templateId) return false;
  return !desire.reviewedAt;
}

// The same sentence as a Prisma `where` — MUST agree with desireNeedsReview
// above, the same "keep the pure predicate and the where in sync" rule
// avatarReview.js states for its own pair.
//
// reviewedAt is deliberately NOT in this where. The queue is meant to show
// reviewed rows too, dimmed rather than dropped, so a GM can see what they
// already cleared without switching views — reviewedAt is a sort key for
// the caller (unreviewed first), not a filter here.
function desireReviewWhere() {
  return {
    status: "FULFILLED",
    templateId: { not: null },
  };
}

// The transaction body of revoking a GM-fulfilled Desire, lifted out of
// revokeDesireGmImpl (web/app/(app)/gm/dev/characters/[characterId]/actions.js)
// so the review queue's reject action and the Dev Panel's revoke button run
// through one path instead of two copies drifting apart. Called with a
// transaction (or the plain client) already holding the row lock the caller
// took before this runs.
//
// Deliberately does NOT touch mood. The claim itself applies
// DESIRE_RELIEF_PER_POINT (docs/systemdocs/MOOD.md); the original revoke never
// reversed it, and this refactor doesn't change that — a GM walking back a
// claim is not the same event as the mood dial's own logic deciding to.
async function revokeDesireCore(tx, { characterId, desireId, desire }) {
  const { count } = await tx.desire.updateMany({
    where: { id: desireId, characterId, status: { not: "CANCELLED" } },
    data: { status: "CANCELLED", endedTurnNumber: null },
  });
  // Guarded against a race: two Revokes fired together would both pass the
  // caller's read, and only the one that actually flipped the row may take
  // the points back.
  if (count === 0) throw new DesireRevokeRefused("That desire was already revoked.");
  if (desire.status === "FULFILLED") {
    await tx.character.update({
      where: { id: characterId },
      data: { tagPoints: { decrement: desire.points } },
    });
  }
  return desire.status === "FULFILLED" ? desire.points : 0;
}

module.exports = {
  DesireRevokeRefused,
  desireNeedsReview,
  desireReviewWhere,
  revokeDesireCore,
};
