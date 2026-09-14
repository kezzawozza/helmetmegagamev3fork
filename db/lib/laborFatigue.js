// Tired -> Exhausted ladder (docs/systemdocs/TAGS.md, docs/systemdocs/LABORING.md §4). Labor
// (db/lib/moveEffects.js) and a bad night (db/lib/dawnAfflictionPass.js) both escalate identically;
// the Exhausted->Tired decay is the ordinary `expiresInto` chain (TAGS.md §5c). Pure and DB-free.
const { TIRED_SLUG, EXHAUSTED_SLUG } = require("./constants");

// Returns the slug to grant, or null if already at the top of the ladder.
function nextLaborFatigueSlug(heldSlugs) {
  if (heldSlugs.has(EXHAUSTED_SLUG)) return null;
  return heldSlugs.has(TIRED_SLUG) ? EXHAUSTED_SLUG : TIRED_SLUG;
}

module.exports = { nextLaborFatigueSlug };
