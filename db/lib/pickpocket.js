// The Pickpocket verb's die and its weight budget (docs/systemdocs/THEFT.md §2).
// Going through a standing person's pockets.
//
// Three outcomes rather than two, and the middle one is the whole texture: you
// get the goods AND they feel it. A pickpocket who only ever succeeded silently
// or failed harmlessly would be a free action with no reason not to press it.
//
// Pure: no prisma, no I/O, so db/test/pickpocket.test.js covers all of it. The
// two requires below are both zero-require leaves themselves, for the same
// reason — this is reachable from a client component.
const { isTradeable } = require("./tradeable");
const { WEIGHTLESS_CATEGORY, rowWeight } = require("./tagWeight");

// The tag the verb needs at all, and the second rung on top of it.
const PICKPOCKET_SLUG = "pickpocket";
const PICKPOCKET_SKILLED_SLUG = "pickpocketing-skilled";

// Skilled is +1 on the die, which lifts a natural 1 clear of the failure band —
// a master never fails outright, which is what "almost always succeeds" means.
const SKILLED_BONUS = 1;

// What you can walk off with, in pounds. Weighed with db/lib/tagWeight.js#rowWeight,
// so the Assets rule (a horse carries itself) applies here the same as anywhere.
const BUDGET_LBS = 15;
const SKILLED_BUDGET_LBS = 30;

// The bands, read off the MODIFIED total.
const CLEAN = "clean"; // 4+ — they are told nothing
const NOTICED = "noticed"; // 2-3 — the goods move, and they feel it
const FAILED = "failed"; // 1 — nothing moves, and they feel it

// What is actually liftable out of somebody's pockets. THREE filters, and each
// one is load-bearing:
//
//   - `tradeable` — the Loot filter. Skills, injuries, beliefs and statuses are
//     not cargo and were never takeable.
//   - NOT `equipped` — lifting a worn breastplate off a standing man is not
//     pickpocketing, it is a fight. This makes the verb strictly narrower than
//     Search's Hide picker, which DOES treat a WORN dagger as palmable, and the
//     difference is deliberate: Search asks what you could hide on yourself,
//     this asks what somebody else's fingers could reach.
//   - NOT an Asset — and this is the one that would otherwise be a hole rather
//     than a nicety. An Asset weighs 0 on purpose (a horse carries itself,
//     docs/systemdocs/CARRY.md §1), so a weight budget cannot bound it: 15 lb
//     would buy every horse, deed and house a person had on them, unlimited,
//     because none of it counts. The budget is the only brake this verb has, so
//     anything the budget cannot measure has to be off the table entirely.
function pickpocketableHoldings(characterTags = []) {
  return (characterTags ?? []).filter((ct) => {
    if (!ct?.tag || !isTradeable(ct.tag)) return false;
    if (ct.equipped) return false;
    if (String(ct.tag.category ?? "").toLowerCase() === WEIGHTLESS_CATEGORY) return false;
    return (ct.quantity ?? 0) > 0;
  });
}

function slugsOf(characterTags = []) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

function holdsPickpocket(characterTags = []) {
  const held = slugsOf(characterTags);
  return held.has(PICKPOCKET_SLUG) || held.has(PICKPOCKET_SKILLED_SLUG);
}

// Skilled alone is enough. The catalog makes it requiredTag: pickpocket, so in
// practice a holder has both — but reading the pair rather than the pair's
// invariant means a GM grant of the top rung on its own still works.
function isSkilled(characterTags = []) {
  return slugsOf(characterTags).has(PICKPOCKET_SKILLED_SLUG);
}

function pickpocketBonus(characterTags = []) {
  return isSkilled(characterTags) ? SKILLED_BONUS : 0;
}

function pickpocketBudgetLbs(characterTags = []) {
  return isSkilled(characterTags) ? SKILLED_BUDGET_LBS : BUDGET_LBS;
}

// -> "clean" | "noticed" | "failed", off the die PLUS the bonus.
function pickpocketOutcome(total) {
  const n = Number(total) || 0;
  if (n >= 4) return CLEAN;
  if (n >= 2) return NOTICED;
  return FAILED;
}

// Did anything move? Both success bands did.
function pickpocketTook(outcome) {
  return outcome === CLEAN || outcome === NOTICED;
}

// What a set of picked lines weighs against the budget. Takes the LINES a
// caller resolved (each `{ held, quantity }`), not the holdings, because a
// player may take 2 of a stack of 5.
function weighPicks(lines = []) {
  return (lines ?? []).reduce((sum, l) => sum + rowWeight({ ...l.held, quantity: l.quantity }), 0);
}

module.exports = {
  PICKPOCKET_SLUG,
  PICKPOCKET_SKILLED_SLUG,
  SKILLED_BONUS,
  BUDGET_LBS,
  SKILLED_BUDGET_LBS,
  CLEAN,
  NOTICED,
  FAILED,
  holdsPickpocket,
  pickpocketableHoldings,
  weighPicks,
  isSkilled,
  pickpocketBonus,
  pickpocketBudgetLbs,
  pickpocketOutcome,
  pickpocketTook,
};
