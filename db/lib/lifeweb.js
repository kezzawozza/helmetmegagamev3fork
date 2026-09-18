// The Lifeweb's blood pool: GameState.lifewebBlood, 0-100. Fed by Donate
// Blood (donor lives, takes Drained) and Feed Person (someone fed whole). The
// single source of both numbers, shared by the GM panel and player-facing
// Requests (same posture as gambitModifier.js) so shown and applied amounts can't drift.

const { NOBILITY_SLUG, COURTIER_SLUG } = require("./constants");
const { getGameState } = require("./gameState");

const BLOOD_MAX = 100;

// At or below this, the Tower isn't holding the valley together any more —
// read by the turn announcement, /lifeweb's status label, and the mining
// resolver, which cuts every payout by 95%
// (db/lib/mining.js). Lives here, not db/index.js, so db/lib/ modules
// can reach it without a barrel require resolving to a partial exports object.
const LIFEWEB_SPUTTER_THRESHOLD = 20;
const FEED_PERSON_AMOUNT = 100;

// Whose blood decides what it's worth: noble > courtier > commoner. Keyed on the bled character's
// tags, not the Mortus doing the bleeding.
const DONATE_BLOOD_BASE = 20;
const DONATE_BLOOD_BY_TAG = [
  { slug: NOBILITY_SLUG, amount: 40, label: "Nobility" },
  { slug: COURTIER_SLUG, amount: 30, label: "Courtier" },
];

// Accepts CharacterTag[] (`{ tag: { slug } }`) and tolerates bare Tag[]. Highest tier wins.
function bloodValueForTags(characterTags = []) {
  const slugs = new Set(characterTags.map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
  for (const tier of DONATE_BLOOD_BY_TAG) {
    if (slugs.has(tier.slug)) return { amount: tier.amount, tier: tier.label };
  }
  return { amount: DONATE_BLOOD_BASE, tier: null };
}

// Returns the delta ACTUALLY applied, not asked for: the pool caps at 100, so
// donating 40 onto a pool at 90 moves 10, and an Undo reversing the nominal
// 40 would mint 30 blood from nothing. Callers snapshot `delta` onto
// Request.effect (payload-vs-effect rule, REQUESTS.md §2).
function applyBlood(current, amount) {
  const before = Math.max(0, Math.min(BLOOD_MAX, current ?? 0));
  const after = Math.max(0, Math.min(BLOOD_MAX, before + amount));
  return { before, after, delta: after - before };
}

// The atomic twin of applyBlood, and the one every writer should use: clamps
// inside a single locked UPDATE instead of a read-modify-write, so two
// concurrent donations can't stomp each other. Takes `tx` as a parameter (db/lib/dm.js convention).
async function bumpBlood(tx, amount) {
  if (!amount) {
    const state = await getGameState(tx);
    const current = Math.max(0, Math.min(BLOOD_MAX, state.lifewebBlood ?? 0));
    return { before: current, after: current, delta: 0 };
  }

  await getGameState(tx);

  const rows = await tx.$queryRaw`
    WITH prev AS (
      SELECT "lifewebBlood" AS before FROM "GameState" WHERE "id" = 1 FOR UPDATE
    )
    UPDATE "GameState" g
    SET "lifewebBlood" = LEAST(${BLOOD_MAX}, GREATEST(0, prev.before + ${amount}))
    FROM prev
    WHERE g."id" = 1
    RETURNING prev.before AS before, g."lifewebBlood" AS after
  `;

  const before = rows[0]?.before ?? 0;
  const after = rows[0]?.after ?? before;
  return { before, after, delta: after - before };
}

module.exports = {
  BLOOD_MAX,
  LIFEWEB_SPUTTER_THRESHOLD,
  bumpBlood,
  FEED_PERSON_AMOUNT,
  DONATE_BLOOD_BY_TAG,
  bloodValueForTags,
  applyBlood,
};
