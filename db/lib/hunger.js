// The 0-100 hunger meter (the Soilery doc, pages 1-2; docs/systemdocs/COOKING.md
// §3 for the `cooked.hunger` field this reads). Replaces the old
// ⬢-upkeep/streak/Gambit-penalty system outright — see the plan's Context §1.
// No Prisma import here, same posture as db/lib/gambitModifier.js/godflesh.js,
// so both bot/ and web/ can import this by subpath without dragging in the
// generated Prisma client.
const { HUNGERLESS_SLUG, FAST_METABOLISM_SLUG, ATE_MEAL_SLUG } = require("./constants");

const HUNGER_MAX = 100;
const HUNGER_MIN = 0;
const HUNGER_DECAY_PER_TURN = 10;
const HUNGER_DECAY_FAST_METABOLISM = 20;

// <= is Hungry, <= is Starving. Starving sits INSIDE the Hungry range on
// purpose — a character at or below 0 is both hungry and starving at once
// (both tags may be held together); it is only the Gambit modifier
// (db/lib/gambitModifier.js) that picks one and never sums them.
const HUNGRY_THRESHOLD = 30;
const STARVING_THRESHOLD = 0;

// One-time mood hit, charged only on the turn a character crosses DOWN into
// a band — never once per turn they simply remain in it.
const THRESHOLD_MOOD_HIT = -30;
// What eating raw (uncooked) food costs before the food's own mood term is
// added — see rawFoodMoodTerms below.
const RAW_FOOD_MOOD = -10;

// INFERRED — this plan's own number, not the design doc's (Context §6). The
// doc names no Dying-replacement rule for prolonged Starving; three
// consecutive closes at 0 hunger was chosen to mirror the shape of the old
// HUNGER_STREAK_CAP mechanic it replaces. Easy to retune post-merge.
const STARVING_DEATH_TURNS = 3;
// INFERRED — this plan's own number, not the design doc's (Context §6). A
// fallback so the ~32 existing unpriced `items-food` tags (anything that
// still grants `ate-meal` but carries no `cooked.hunger`/`mealHunger`) don't
// become inedible under the new meter. Easy to retune post-merge. Scaled
// ×3 alongside every doc-given hunger value when the meter moved to 0-100.
const DEFAULT_FOOD_HUNGER = 12;

function clampHunger(value) {
  const n = Number.isFinite(value) ? value : 0;
  return Math.min(HUNGER_MAX, Math.max(HUNGER_MIN, Math.round(n)));
}

// Always returns a band. Starving is checked first since it's the tighter
// (inner) range — a value of 0 is both, but "starving" is the one word that
// answers "how hungry is this character" when asked for a single band.
function bandOf(hungerValue) {
  const v = clampHunger(hungerValue);
  if (v <= STARVING_THRESHOLD) return "starving";
  if (v <= HUNGRY_THRESHOLD) return "hungry";
  return "fed";
}

// Accepts a Set or array of held slugs (either shape callers already pass to
// db/lib/mood.js's multiplierFor). Hungerless never decays; Fast Metabolism
// decays twice as fast; everyone else pays the flat rate.
function decayFor(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  if (held.has(HUNGERLESS_SLUG)) return 0;
  if (held.has(FAST_METABOLISM_SLUG)) return HUNGER_DECAY_FAST_METABOLISM;
  return HUNGER_DECAY_PER_TURN;
}

// before/after are raw hungerValue numbers (not clamped by the caller is
// fine — this clamps its own reads). Reports each threshold's crossing
// independently, in EITHER direction, so a caller can grant/drop each tag
// and charge each onset mood hit exactly once — even when a single turn's
// decay crosses both bands at once (never -60: each band's hit is its own
// term, and hungerPass charges the ones that fired, not one per point lost).
function crossings(before, after) {
  const b = clampHunger(before);
  const a = clampHunger(after);
  return {
    enteredHungry: b > HUNGRY_THRESHOLD && a <= HUNGRY_THRESHOLD,
    enteredStarving: b > STARVING_THRESHOLD && a <= STARVING_THRESHOLD,
    leftHungry: b <= HUNGRY_THRESHOLD && a > HUNGRY_THRESHOLD,
    leftStarving: b <= STARVING_THRESHOLD && a > STARVING_THRESHOLD,
  };
}

function grantsAteMeal(tag) {
  return Array.isArray(tag?.consumesInto) && tag.consumesInto.includes(ATE_MEAL_SLUG);
}

// How much a single held/eaten tag restores on the meter. A recipe's own
// `mealHunger` (Tag.mealHunger, copied onto a minted dish by
// db/lib/customCraftMint.js) wins outright; failing that, an ingredient's own
// `cooked.hunger`; failing that, DEFAULT_FOOD_HUNGER for anything that still
// grants `ate-meal` (an existing foodstuff tag nobody has priced yet), or 0
// for anything that isn't food at all.
function foodHungerFor(tag) {
  if (!tag) return 0;
  if (Number.isInteger(tag.mealHunger)) return tag.mealHunger;
  if (Number.isInteger(tag.cooked?.hunger)) return tag.cooked.hunger;
  return grantsAteMeal(tag) ? DEFAULT_FOOD_HUNGER : 0;
}

// What eating something RAW costs/earns as mood terms, mirroring
// db/lib/mood.js#dishMoodTerms's returned-terms shape so applyMoodTerms
// handles either the same way. Raw food always carries the flat RAW_FOOD
// penalty (noMultiplier, same reasoning DISGUST already uses — revulsion at
// eating something uncooked isn't a fright, so no tag scales it); on top of
// that, the food's own `cooked.mood` lands as a MEAL term if positive or a
// DISGUST term (also noMultiplier) if negative. A cooked dish never calls
// this — dishMoodTerms is the cooked path, and the two never combine.
function rawFoodMoodTerms(cookedMood) {
  const mood = Number.isFinite(cookedMood) ? cookedMood : 0;
  const terms = [{ kind: "RAW_FOOD", base: RAW_FOOD_MOOD, noMultiplier: true }];
  if (mood > 0) terms.push({ kind: "MEAL", base: mood });
  else if (mood < 0) terms.push({ kind: "DISGUST", base: mood, noMultiplier: true });
  return terms;
}

// The per-band DM copy (the Soilery doc's hunger section). No line names a
// number, per the doc. Replaces hungerPass.js's old inline streak-based copy.
function hungerDm(notice) {
  if (notice.kind === "hungry") {
    return "Your stomach has started to complain. Find something to eat.";
  }
  if (notice.kind === "starving") {
    return "You are starving. You need food now.";
  }
  if (notice.kind === "recovered") {
    return "You've eaten enough. The gnawing has stopped.";
  }
  return null;
}

// Sent alongside a "starving" notice the turn `dying` first lands
// (notice.justDied) — db/lib/turnSideEffects/steps/hunger.js. Kept as its
// own export, same as the old hungerPass.js DYING_DM, rather than folded
// into hungerDm's kind switch: it always rides BESIDE a starving notice,
// never instead of one.
const DYING_DM =
  "You have not eaten in days. Your body is giving out — you're **Dying**. A GM will decide what happens next.";

module.exports = {
  HUNGER_MAX,
  HUNGER_MIN,
  HUNGER_DECAY_PER_TURN,
  HUNGER_DECAY_FAST_METABOLISM,
  HUNGRY_THRESHOLD,
  STARVING_THRESHOLD,
  THRESHOLD_MOOD_HIT,
  RAW_FOOD_MOOD,
  STARVING_DEATH_TURNS,
  DEFAULT_FOOD_HUNGER,
  clampHunger,
  bandOf,
  decayFor,
  crossings,
  foodHungerFor,
  rawFoodMoodTerms,
  hungerDm,
  DYING_DM,
};
