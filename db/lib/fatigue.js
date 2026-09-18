// Tired -> Exhausted ladder (docs/systemdocs/TAGS.md). Three unrelated things climb it and they
// all climb it identically: a day's mining (db/lib/moveEffects.js), a bad night
// (db/lib/dawnAfflictionPass.js) and pushing on through a travel gate
// (db/lib/locationTravel.js). The Exhausted->Tired decay is the ordinary `expiresInto` chain
// (TAGS.md §5c).
const { TIRED_SLUG, EXHAUSTED_SLUG } = require("./constants");
const { expiryFrom } = require("./turnFormat");

// Returns the slug to grant, or null if already at the top of the ladder.
function nextFatigueSlug(heldSlugs) {
  if (heldSlugs.has(EXHAUSTED_SLUG)) return null;
  return heldSlugs.has(TIRED_SLUG) ? EXHAUSTED_SLUG : TIRED_SLUG;
}

// Farming's lockout (db/lib/soilery.js; Context §2 of the Soilery plan): unlike the ladder above,
// which ESCALATES Tired into Exhausted, a day sowing a field grants Exhausted OUTRIGHT — there is
// no lesser rung to climb through first. If the character already holds Tired (say, from an
// unrelated day of mining earlier the same turn), it's replaced rather than left to stack alongside
// Exhausted; its `expiresTurn` is snapshotted so db/lib/moveEffects.js's `farmed` entry can restore
// it exactly on Undo. `turnNumber` is the CLOSING turn's number — this adds one itself, the same
// "+1" the `exhausted` MOVE_EFFECTS entry already applies when it grants at push.
async function grantExhaustedOutright(tx, characterId, turnNumber) {
  const heldTired = await tx.characterTag.findFirst({
    where: { characterId, tag: { slug: TIRED_SLUG } },
    select: { id: true, expiresTurn: true },
  });
  const exhaustedTag = await tx.tag.findUnique({
    where: { slug: EXHAUSTED_SLUG },
    select: { id: true, defaultDurationTurns: true },
  });
  if (!exhaustedTag) {
    console.error(`Farm payout: no "${EXHAUSTED_SLUG}" tag — run npm run db:sync-tags. Farming won't be limited.`);
    return null;
  }
  if (heldTired) await tx.characterTag.delete({ where: { id: heldTired.id } });
  // skipDuplicates: an existing Exhausted keeps its own clock (same rule as db/lib/tagExpiryPass.js).
  await tx.characterTag.createMany({
    data: [{
      characterId,
      tagId: exhaustedTag.id,
      source: "EVENT",
      expiresTurn: expiryFrom(turnNumber + 1, exhaustedTag.defaultDurationTurns ?? 1),
    }],
    skipDuplicates: true,
  });
  return { replacedTired: heldTired ? { expiresTurn: heldTired.expiresTurn } : null };
}

module.exports = { nextFatigueSlug, grantExhaustedOutright };
