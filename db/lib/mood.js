// The mood dial (docs/systemdocs/MOOD.md). Character.mood is a signed number
// (+82..−100) shown to players as one word (band), from Panicking to Ecstatic;
// see MOOD.md for the table. Harm/relief terms are scaled by held tags
// (Brave, Rough Camper/Outsider/Spelunker/Pale, the phobias) and by
// GameConfig.moodIntensity (k: harm × k, relief ÷ k; k=0 disables).
// Top half is pure (db/test/mood.test.js exercises it); bottom half is the
// Prisma-in-tx surface (applyMood, applyMoodTerms, applyWoundMood), each
// taking `tx` first per the db/lib/dm.js convention so hooks ride the caller's
// transaction. No network call here — a band-change DM is handed back and,
// unless told not to, scheduled via setMoodDmSender after commit; the turn
// pass passes `notify: false` and carries DMs back itself.
// Not on the @lifeweb/db barrel — require by subpath so web/lib can use the
// pure half without the Prisma client. No require of ./tagWrites here: it
// requires this module for applyWoundMood, and a cycle would break one.
const { hasAttribute, SAFE_ATTRIBUTE, WILDERNESS_ATTRIBUTE, HAVEN_ATTRIBUTE } = require("./locationAttributes");
const {
  DYING_SLUG,
  IMPERTURBABLE_SLUG,
  CHANGA_HIGH_SLUG,
  AMOR_FATI_SLUG,
  WOUND_TAG_GROUPS,
} = require("./constants");


// Ecstatic mirrors Afraid (same width/distance from Fine), Panicking has no twin.
const MOOD_MAX = 82;
const MOOD_MIN = -100;

// Ten bands, 18 wide, symmetric about Fine but for Panicking. `tone` is read
// by web/app/components/StatusPill.js; `gambit` (die modifier, db/lib/gambitModifier.js)
// is nonzero only on the three extremes — Ecstatic +1, Afraid −1, Panicking −2.
const MOOD_BANDS = Object.freeze([
  { min: -Infinity, max: -82, key: "panicking", label: "Panicking", tone: "bad", gambit: -2 },
  { min: -82, max: -64, key: "afraid", label: "Afraid", tone: "bad", gambit: -1 },
  { min: -64, max: -46, key: "anxious", label: "Anxious", tone: "warn", gambit: 0 },
  { min: -46, max: -28, key: "stressed", label: "Stressed", tone: "warn", gambit: 0 },
  { min: -28, max: -10, key: "uncomfortable", label: "Uncomfortable", tone: "warn", gambit: 0 },
  { min: -10, max: 10, key: "fine", label: "Fine", tone: "muted", gambit: 0 },
  { min: 10, max: 28, key: "content", label: "Content", tone: "good", gambit: 0 },
  { min: 28, max: 46, key: "pleased", label: "Pleased", tone: "good", gambit: 0 },
  { min: 46, max: 64, key: "happy", label: "Happy", tone: "good", gambit: 0 },
  // Infinity rather than MOOD_MAX, mirroring Panicking's −Infinity, so an
  // unclamped read still lands in a band instead of falling out of the table.
  { min: 64, max: Infinity, key: "ecstatic", label: "Ecstatic", tone: "good", gambit: 1 },
]);

// DMed bands are the three that move a Gambit; the other six are sheet-only.
const DM_BAND_KEYS = new Set(["afraid", "panicking", "ecstatic"]);

// What a night somewhere is worth, on top of the drift. Exactly one applies,
// chosen by placeClassOf. Harm is negative, comfort positive.
const PLACE_TERMS = Object.freeze({ CAVE: -14, WILDERNESS: -10, OPEN: 5, INDOORS: 7, HAVEN: 14 });

// Overnight slide toward Fine from both sides, never overshooting 0: fear
// wears off slowly (drift up small), a good evening is mostly gone by morning.
//
// The down figure was 40 until the drug shelf landed. A high that is already
// most of the way gone by the next morning is not worth 20 obols, so
// happiness now decays about a fifth slower. The UP figure is deliberately
// untouched: the asymmetry is the design (MOOD.md §6) — fear and grief are
// the half of the dial a character has to live with, delight is the half
// they have to keep earning.
const MOOD_DRIFT_UP = 4;
const MOOD_DRIFT_DOWN = 32;

// Movement mood is rationed per open turn (walking is cheap and repeatable);
// nothing else is capped. The ration counts the delta that actually landed,
// after multipliers and moodIntensity, not the base — else Brave would get
// double the allowance. Character.moveMoodTurnId/moveMoodUsed track it, same
// shape as zoneMovesTurnId/zoneMovesUsed in locationTravel.js.
const MOVE_MOOD_TURN_CAP = 15;

// Base values, signed: harm is negative, relief positive. applyMood defaults
// to the entry for its kind, so most callers name the kind and nothing else.
// See MOOD.md for the table with prose. BOUND_HELD and the two moves are
// passed as `base` by their callers because they share a kind with another
// row.
const EVENTS = Object.freeze({
  WILDERNESS_MOVE: -2,
  CAVE_MOVE: -3,
  DYING: -40,
  CAVE_TROUBLE: -10,
  BOUND: -15,
  BOUND_HELD: -10,
  CRUCIFIED: -80,
  TORTURED: -40,
  MUTILATED: -50,
  BRANDED: -40,
  DEATH_SEEN: -15,
  CORPSE: -5,
  TURRET: -25,
  HUNGER: -5,
  STARVING: -10,
  // One-time hits, charged only the turn a character crosses DOWN into the
  // band (db/lib/hunger.js's THRESHOLD_MOOD_HIT) — not the nightly ambient
  // HUNGER/STARVING above, which keep landing every turn the band holds.
  HUNGRY_ONSET: -30,
  STARVING_ONSET: -30,
  NOBLE_MEAL: -10,
  ROBBED: -10,
  CONFESSION: 17,
  KISS: 17,
  MUSIC: 12,
  CATHEDRAL: 12,
});
const DESIRE_RELIEF_PER_POINT = 12;
const DRINK_RELIEF = 35;

// What one consume is worth, by the STATUS it lands you in (a drink or a drug
// — keyed this way so a brew added to the catalog later is soothing the day it
// ships) or, for the ones that grant nothing distinctive, by the item itself.
// consumeReliefFor takes the MAX across all of it, never a sum: Bliss lands
// both euphoric and high and is one drink, and Sweets is a treat rather than
// a treat plus a meal.
//
// A COOKED MEAL IS NOT IN HERE, and cannot be. `fine-meal: 15` and
// `lavish-meal: 30` sat in this table until the cooking rework; they were
// flat, they were the largest single figures a meal could reach, and the
// moment every meal became a MINTED row (COOKING.md) their slugs stopped
// matching anything — a dish's slug is `custom-craft-…`. A dish is priced by
// dishMoodTerms below instead, off its own `mealMood` and what went into it.
// `ate-meal: 5` stays and is now genuinely the floor under every meal.
const CONSUME_RELIEF = Object.freeze({
  tipsy: DRINK_RELIEF,
  wasted: DRINK_RELIEF,
  unconscious: DRINK_RELIEF,
  "blind-drunk": DRINK_RELIEF,
  high: DRINK_RELIEF,
  euphoric: DRINK_RELIEF,
  // A hot drink. Keyed on the status rather than the bean, same as the drinks.
  tea: 17,
  caffeinated: 17,
  // Maggot Milk is deliberately NOT here any more (the hunger meter rework):
  // it carries its own `cooked.mood: 7` now and is priced by the new
  // raw-food rule (db/lib/hunger.js#rawFoodMoodTerms), same as Honey and
  // Fish Roe below — a row here would silently win over that.
  // The Silver Chip shelf. These are ITEM-keyed on purpose: Bliss grants
  // `euphoric` and `high`, both of which sit above at DRINK_RELIEF, and an
  // item row wins outright over its grants -- which is the whole point, since
  // a refined drug should not be worth the same as the fungus it came from.
  //
  // Heroin and Changa are deliberately absent. Neither ADDS to the dial; both
  // put it at the top outright (MOOD_MAX_CONSUMABLES below), which no figure
  // in this table can express -- +82 from a frightened character still lands
  // short of Ecstatic.
  bliss: 80,
  "eth-lod": 20,
  // The treats. Sugar does not grow in Ravenheart.
  "sugar-candy": 9,
  "honeyed-cakes": 9,
  pumpkin: 9,
  // Celebrations. Neither grants a status, so both key by the item.
  "sky-lantern": 9,
  firecracker: 9,
  cigarette: 9,
  // Any proper meal at all, and the floor under every food above.
  "ate-meal": 6,
  // The Ration Box's bad draws (all `consumesInto: [ate-meal]` too, which is
  // exactly why consumeReliefFor above has to let the item's own negative
  // entry win outright rather than being maxed against ate-meal's floor).
  "moldy-bread": -10,
  "grasshopper-kebab": -15,
  "jellied-meats": -10,
  "budget-cold-soup": -5,
});

// Which Health groups sink a mood when they land. Illness, mind, minor and
// recovery do not — a cold is not a wound.
const WOUND_GROUPS = new Set(WOUND_TAG_GROUPS);
const BURN_SLUGS = new Set(["burned", "severe-burns"]);
// Cure-ladder rung (TAGS.md §5c) -> what it costs the mood, signed. The half
// rungs are the six named exceptions the ladder documents.
const WOUND_MOOD_BY_RUNG = Object.freeze({
  0: 0,
  0.5: -4,
  1: -8,
  2: -15,
  3: -30,
  3.5: -35,
  4: -40,
  5: -45,
  6: -55,
  7: -65,
});

// slug -> which kinds it scales, and by how much. "*" is every harm. `when`
// is an extra predicate on the event's ctx (Pyrophobia only bites on a burn).
// Relief is never multiplied; resolveDelta only consults this for base < 0.
const MULTIPLIERS = Object.freeze([
  { slug: "brave", kinds: "*", factor: 0.5 },
  { slug: "rough-camper", kinds: ["WILDERNESS", "CAVE"], factor: 0.5 },
  { slug: "outsider", kinds: ["WILDERNESS"], factor: 0 },
  { slug: "spelunker", kinds: ["CAVE"], factor: 0 },
  { slug: "pale", kinds: ["CAVE"], factor: 0.5 },
  { slug: "hemophobia", kinds: ["WOUND"], factor: 2 },
  { slug: "agoraphobia", kinds: ["WILDERNESS"], factor: 2 },
  { slug: "claustrophobia", kinds: ["CAVE"], factor: 2 },
  { slug: "teratophobia", kinds: ["CAVE_TROUBLE"], factor: 3 },
  { slug: "pyrophobia", kinds: ["WOUND"], factor: 3, when: (ctx) => Boolean(ctx?.burn) },
  // Pain you cannot feel is not frightening. Both are two-turn statuses, so a
  // torturer who waits a day gets the full −40 (db/lib/torture.js). BRANDED
  // is the same kind of harm — a hot iron held to someone who can't stop it —
  // so it gets the same two immunities.
  { slug: "pain-immunity", kinds: ["TORTURED", "BRANDED"], factor: 0 },
  { slug: "opium-high", kinds: ["TORTURED", "BRANDED"], factor: 0 },
  // The Rite of Rage (docs/systemdocs/THANATI.md §4): "Rage people do not
  // become afraid." Every kind, permanently.
  { slug: "rage", kinds: "*", factor: 0 },
  // The blade quenched in an Aberrant's heart: the wielder's dial does not
  // fall AT ALL while it is in hand. `equipped` rules only fire when the
  // caller can say what is equipped (equippedSlugs below); a caller that
  // cannot simply never applies them, which fails safe — no free immunity.
  { slug: "heartforged-blade", kinds: "*", factor: 0, equipped: true },
]);
// Amor Fati (a mastery, TAGS.md 4a) — the one rule that is NOT a multiplier,
// and it has to stay that way.
//
// It reads like a factor of -0.5, and it was one for a day. But `multiplierFor`
// MULTIPLIES every applicable rule together, so a negative factor composed with
// the vulnerability rows and inverted them: Teratophobia's ×3 turned cave
// trouble into +15 rather than +5, Hemophobia's ×2 paid a wound back at FULL
// value instead of half, and Brave's ×0.5 — a tag you pay points for — HALVED
// the relief. Since the phobias refund points, stacking one was strictly better
// and strictly cheaper. Backwards in both directions.
//
// So for a kind it owns, Amor Fati REPLACES the multiplier chain rather than
// joining it: the gift is half of what the event costs anybody, and what you
// happen to fear or how brave you are does not change it. Nothing can compose
// with it, so nothing can invert it.
//
// Split in two on purpose. SHOCK is misfortune that HAPPENS to you — an author
// and a moment — and pays back half of what it cost. AMBIENT is the weather:
// ever-present costs nobody would call an incident, which simply stop landing
// rather than becoming a pleasure. WILDERNESS and CAVE cover both the arrival
// hit and the nightly one, since the kind is the same for each. DRIFT needs no
// entry (it carries noMultiplier) and PLACE harm is already capped at Fine.
const AMOR_FATI_SHOCK = Object.freeze(
  new Set(["WOUND", "DYING", "CRUCIFIED", "TORTURED", "MUTILATED", "BRANDED", "BOUND", "ROBBED", "TURRET", "CAVE_TROUBLE", "DEATH_SEEN"]),
);
const AMOR_FATI_AMBIENT = Object.freeze(new Set(["WILDERNESS", "CAVE", "HUNGER", "STARVING", "CORPSE", "NOBLE_MEAL"]));
const AMOR_FATI_SHARE = -0.5;

// Takes the RAW base, not the multiplied harm, and that is the fix rather than
// an implementation detail. Reordering alone changes nothing — multiplication
// commutes, so `base × phobia × -0.5` is the same number either way. What has
// to go is the phobia's involvement at all: the gift is half of what the event
// COSTS, not half of what it would have cost this particular sufferer.
//
// Returns `{ handled, value }`. `handled: false` means Amor Fati has no opinion
// about this kind and the ordinary multiplied path should run.
function amorFatiHarm(kind, base, heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  if (!held.has(AMOR_FATI_SLUG)) return { handled: false, value: 0 };
  if (AMOR_FATI_AMBIENT.has(kind)) return { handled: true, value: 0 };
  if (AMOR_FATI_SHOCK.has(kind)) return { handled: true, value: base * AMOR_FATI_SHARE };
  return { handled: false, value: 0 };
}

// Every slug the mood system reads, so a caller loading a sheet knows what to
// select — and so the turn pass can filter its candidate query. Imperturbable
// is on the list without being in the table above: it works through
// `intensity` rather than a multiplier (see applyMoodTerms), but a pass that
// did not SELECT it would compute the whole night as though the holder were
// ordinary. That is exactly the silent kind of miss this list exists to stop,
// so anything the dial reads belongs here whether or not it is a multiplier.
const MULTIPLIER_SLUGS = [
  ...new Set([...MULTIPLIERS.map((m) => m.slug), IMPERTURBABLE_SLUG, CHANGA_HIGH_SLUG, AMOR_FATI_SLUG]),
];

// --- the pure half --------------------------------------------------------

function clampMood(value) {
  const n = Number.isFinite(value) ? value : 0;
  return Math.round(Math.min(MOOD_MAX, Math.max(MOOD_MIN, n)) * 100) / 100;
}

// Always returns a band — a mood of 0 is Fine, which is a word like any
// other. Below 0 the interval is (min, max], above it [min, max), so the
// boundary always belongs to the further-from-Fine band on either side.
function bandOf(value) {
  const v = clampMood(value);
  return MOOD_BANDS.find((b) => (v < 0 ? v > b.min && v <= b.max : v >= b.min && v < b.max)) ?? null;
}

// Where somebody is, as the dial sees it. Haven wins over its own roof; a
// `safe` cave Location (Customs) is a lit room with a sentry, so it reads as
// a roof rather than as the dark.
function placeClassOf(location) {
  if (!location) return "OPEN";
  if (hasAttribute(location, HAVEN_ATTRIBUTE)) return "HAVEN";
  if (location.zone?.kind === "CAVE_LEVEL") return hasAttribute(location, SAFE_ATTRIBUTE) ? "INDOORS" : "CAVE";
  if (location.indoors) return "INDOORS";
  if (hasAttribute(location, WILDERNESS_ATTRIBUTE)) return "WILDERNESS";
  return "OPEN";
}

// The turn-end term for a place class: { kind, base }. Harm carries its own
// kind so Rough Camper and friends can find it; comfort is plain PLACE and
// carries `capAtFine`, because OPEN, INDOORS and HAVEN are all degrees of
// "nothing is hurting me" rather than degrees of delight.
function placeTermFor(placeClass) {
  const base = PLACE_TERMS[placeClass];
  if (base < 0) return { kind: placeClass, base };
  return { kind: "PLACE", base, capAtFine: true };
}

// The overnight slide back toward Fine, or null for somebody already there.
// Slow coming up, fast coming down. It is not a fright, so no tag scales it —
// hence noMultiplier: Brave halving a happy person's decline would be nonsense,
// and so would it sparing them the climb.
function driftTermFor(mood) {
  const v = clampMood(mood);
  if (v === 0) return null;
  const base = v < 0 ? Math.min(MOOD_DRIFT_UP, -v) : -Math.min(MOOD_DRIFT_DOWN, v);
  return { kind: "DRIFT", base, noMultiplier: true };
}

// How much of a restorative term actually lands. Shelter and the Cathedral mend
// a bad day; they are not a good one, so they fill the hole up to Fine and stop
// there. Where a character merely IS cannot make them happy — only what they
// do, eat or want does that.
//
// `otherDelta` is everything ELSE the same write is about to do, which is what
// makes the answer order-independent: the nightly pass hands all six of its
// terms to ONE applyMoodTerms call, so a rule that read term order would be
// deciding by array position. A character at −5 who goes hungry (−5) and sleeps
// in a Haven (+12) therefore wakes at exactly 0 — the bed absorbs the hunger.
function restorativeRoom(before, otherDelta = 0) {
  const floor = (Number.isFinite(before) ? before : 0) + (Number.isFinite(otherDelta) ? otherDelta : 0);
  return Math.max(0, -floor);
}

// What walking INTO a place costs, or null when it costs nothing.
function arrivalTermFor(location) {
  const cls = placeClassOf(location);
  // `move: true` is what the ration counts. It cannot be inferred from `kind`:
  // placeTermFor returns the SAME two kinds for the nightly charge, because
  // the kind is what the multipliers key on (Rough Camper, Spelunker, the
  // phobias) and a cave is a cave whether you walked in or slept there.
  if (cls === "CAVE") return { kind: "CAVE", base: EVENTS.CAVE_MOVE, move: true };
  if (cls === "WILDERNESS") return { kind: "WILDERNESS", base: EVENTS.WILDERNESS_MOVE, move: true };
  return null;
}

// The cure-ladder rung a wound sits on (TAGS.md §5c), or null for anything
// that is not a wound at all.
//
// AUTHORED now: `cureRung` in docs/tags.yaml. Everything below it is a
// FALLBACK for a tag that never came through the catalog — one a GM wrote in
// the Dev Panel, or a runtime clone — and it works the way this whole function
// used to, by reading the rung back out of the cure's price.
//
// That reading is why the rung is authored now. It told a Simple wound from a
// Moderate one at 2 ⬢ by whether the cure's work denominator was 4 or 3, and
// when costs became decimals in 9/2026 that denominator stopped existing. The
// fallback keeps the shape it can still see and lands the case it cannot on
// the gentler rung — an unauthored 2-⬢ wound reads as Simple rather than
// inventing a severity for it.
function woundRungOf(tag) {
  const group = tag?.group?.slug ?? tag?.groupSlug ?? null;
  if (!group || !WOUND_GROUPS.has(group)) return null;
  if (typeof tag.cureRung === "number") return tag.cureRung;
  const resources = tag.requirementResources;
  const turns = tag.requirementTurns ?? 0;
  const gambit = Boolean(tag.requirementGambit);
  if (resources == null && tag.requirementTurns == null && !gambit) return 0;
  if (gambit) return 7;
  const r = resources ?? 0;
  if (r >= 8) return 6;
  if (r >= 6) return 5;
  if (r >= 4) return 4;
  if (r === 3) return 3.5;
  // The one the price can no longer answer: Simple and Moderate are both 2 ⬢,
  // and both cost a quarter of a Move now. A catalog wound says which it is;
  // anything else gets the benefit of the doubt.
  if (r === 2) return turns <= 0.25 ? 2 : 3;
  if (r === 1) return 1;
  return 0.5;
}

// Signed, like everything else in EVENTS: a wound is negative. Healing one
// gives half of it BACK, so that caller negates this (see the Heal hook).
function woundMoodFor(tag) {
  const rung = woundRungOf(tag);
  if (rung == null) return 0;
  return WOUND_MOOD_BY_RUNG[rung] ?? 0;
}

// The product of every applicable factor. A 0 anywhere wins, whatever else is
// held — Outsider means the wilderness costs nothing, full stop.
function multiplierFor(kind, heldSlugs, ctx = {}, equippedSlugs = null) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  const worn = equippedSlugs instanceof Set ? equippedSlugs : new Set(equippedSlugs ?? []);
  let factor = 1;
  for (const rule of MULTIPLIERS) {
    if (!held.has(rule.slug)) continue;
    // An `equipped` rule reads the sheet's equipped state, not just holding —
    // a Heartforged Blade in a bag steadies nobody.
    if (rule.equipped && !worn.has(rule.slug)) continue;
    if (rule.kinds !== "*" && !rule.kinds.includes(kind)) continue;
    if (rule.when && !rule.when(ctx)) continue;
    factor *= rule.factor;
  }
  return factor;
}

// One term -> the signed change to the dial. Harm: base × multipliers × k.
// Relief, and the drift either way: base ÷ k, untouched by any tag. k = 0
// zeroes both.
function resolveDelta({
  kind,
  base,
  heldSlugs,
  intensity = 1,
  ctx = {},
  equippedSlugs = null,
  noMultiplier = false,
}) {
  const k = Number.isFinite(intensity) && intensity > 0 ? intensity : 0;
  if (!base || k === 0) return 0;
  const harm = base < 0 && !noMultiplier;
  const amor = harm ? amorFatiHarm(kind, base, heldSlugs) : { handled: false, value: 0 };
  const raw = harm
    ? (amor.handled ? amor.value : base * multiplierFor(kind, heldSlugs, ctx, equippedSlugs)) * k
    : base / k;
  // `|| 0` folds -0 back to 0. A zeroing multiplier on a negative base
  // produces it (Outsider in the wilderness, Amor Fati on any of the ambient
  // costs), and while -0 adds like 0 it PRINTS like "-0" in a readout.
  return Math.round(raw * 100) / 100 || 0;
}

// Plain, as asked: the band's name and nothing about the number. Only the two
// bands that cost dice say anything at all, and only on the way IN — a mood
// climbing back out of Afraid is the player's own business.
function moodBandDm(previousBand, band) {
  if (!band || !DM_BAND_KEYS.has(band.key)) return null;
  if ((previousBand?.key ?? null) === band.key) return null;
  return `You are now ${band.label}.`;
}

// --- the Prisma half ------------------------------------------------------

let dmSender = null;
// db/index.js registers the logged REST sender once at load, so a hook deep
// inside a tag write can notify without threading a DM back through five
// callers. Delayed a beat so the transaction that moved the dial has
// committed before the player hears about it.
function setMoodDmSender(fn) {
  dmSender = fn;
}
const DM_DELAY_MS = 1500;
function scheduleMoodDm(dm) {
  if (!dm || !dmSender) return;
  setTimeout(() => {
    Promise.resolve()
      .then(() => dmSender(dm.discordUserId, dm.content))
      .catch((err) => console.error(`Mood DM to ${dm.discordUserId} failed:`, err.message ?? err));
  }, DM_DELAY_MS).unref?.();
}

async function loadIntensity(tx) {
  const config = await tx.gameConfig.findUnique({ where: { id: 1 }, select: { moodIntensity: true } });
  const k = config?.moodIntensity;
  return Number.isFinite(k) ? k : 1;
}

// Moves one character's dial by several terms at once, on `tx`.
// terms: [{ kind, base, ctx?, move?, noMultiplier?, capAtFine? }]. Returns null
// for an unknown character, otherwise
//   { characterId, before, after, delta, moveApplied, restorativeApplied,
//     band, previousBand, dm }
// where `dm` is { discordUserId, content } or null, `moveApplied` is the
// positive magnitude the movement ration just spent, and `restorativeApplied`
// is how much of the `capAtFine` relief actually landed — which answers "why
// didn't my Haven night help". A character who is not
// ALIVE takes nothing.
//
// `character` may be passed in already loaded — { id, status, mood,
// discordUserId, tags: [{ equipped, tag: { slug } }] } — by a caller that has
// a hundred of them in hand (the turn pass); its tags must then cover the
// multiplier slugs. Otherwise the row is read here.
const MOOD_CHARACTER_SELECT = {
  id: true,
  status: true,
  mood: true,
  discordUserId: true,
  moveMoodTurnId: true,
  moveMoodUsed: true,
  tags: { select: { equipped: true, tag: { select: { slug: true } } } },
};
async function applyMoodTerms(
  tx,
  characterId,
  terms,
  { intensity = null, notify = true, character = null, moveCapRemaining = null } = {},
) {
  if (!character) {
    character = await tx.character.findUnique({ where: { id: characterId }, select: MOOD_CHARACTER_SELECT });
  }
  if (!character) return null;

  const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
  const equippedSlugs = new Set(character.tags.filter((ct) => ct.equipped).map((ct) => ct.tag.slug));
  const before = character.mood ?? 0;
  let delta = 0;
  let moveApplied = 0;
  let restorativeApplied = 0;
  // Imperturbable (a mastery, TAGS.md 4a) is the dial's own off switch. It
  // rides on `intensity` rather than on a MULTIPLIERS row because intensity is
  // the one lever that zeroes RELIEF as well as harm — a multiplier is only
  // ever consulted for base < 0, so a row there would have left the holder
  // free to climb to Ecstatic while immune to everything below Fine. `k === 0`
  // is already a case resolveDelta handles (it returns 0 for either sign), so
  // this adds no new arithmetic.
  const unshakable = heldSlugs.has(IMPERTURBABLE_SLUG);
  // Changa's three turns, and the mirror image of Imperturbable below: one
  // pins the dial to Fine, this one pins it to the top. Nothing that happens
  // to somebody on Changa reaches them, which is most of what the drug is
  // for and the reason the come-down is a coin toss with death on one side.
  // Imperturbable wins a tie — being unreachable beats being delighted.
  const soaring = !unshakable && heldSlugs.has(CHANGA_HIGH_SLUG);
  if (character.status === "ALIVE" && terms?.length) {
    const k = unshakable ? 0 : intensity ?? (await loadIntensity(tx));
    let moveDelta = 0;
    let restorativeDelta = 0;
    for (const term of terms) {
      if (!term || !term.base) continue;
      const resolved = resolveDelta({
        kind: term.kind,
        base: term.base,
        heldSlugs,
        intensity: k,
        ctx: term.ctx,
        equippedSlugs,
        noMultiplier: term.noMultiplier,
      });
      if (term.capAtFine) restorativeDelta += resolved;
      else if (term.move) moveDelta += resolved;
      else delta += resolved;
    }
    // The ration only ever bites on the way DOWN; walking into the Cathedral
    // is not movement the cap has an opinion about.
    if (moveCapRemaining != null && moveDelta < 0) {
      moveDelta = Math.max(moveDelta, -Math.max(0, moveCapRemaining));
    }
    moveApplied = moveDelta < 0 ? Math.round(-moveDelta * 100) / 100 : 0;
    // Shelter fills whatever hole is left and stops at Fine. Measured against
    // everything else this write does (restorativeRoom), so two arrivals or a
    // whole night's worth of terms cannot be reordered into a different answer.
    if (restorativeDelta > 0) {
      const allowed = Math.min(restorativeDelta, restorativeRoom(before, delta + moveDelta));
      restorativeApplied = Math.round(allowed * 100) / 100;
    }
    delta = Math.round((delta + moveDelta + restorativeApplied) * 100) / 100;
  }

  let after = before;
  // "Always at 0, Fine" has to hold for a mood the character ALREADY had when
  // they took the tag, not just for the events that stop landing afterwards.
  // Nothing moves an Imperturbable dial, so the correction is a one-time
  // write back to 0 the next time anything asks — the nightly pass reaches
  // every living character, so it settles within a turn at the outside.
  if (unshakable && before !== 0 && character.status === "ALIVE") {
    await tx.character.update({ where: { id: characterId }, data: { mood: 0 } });
    after = 0;
    delta = 0;
  } else if (soaring && character.status === "ALIVE") {
    // No `before !== MOOD_MAX` guard on this one, unlike Imperturbable's.
    // Somebody already at the top still has to take this branch rather than
    // fall through, or the night's own drift term (-32) would land on them
    // and the pin would leak a little every turn.
    if (before !== MOOD_MAX) {
      await tx.character.update({ where: { id: characterId }, data: { mood: MOOD_MAX } });
    }
    after = MOOD_MAX;
    delta = 0;
  } else if (delta !== 0) {
    // Clamped in the database, so two hooks in the same tick cannot race a
    // stale read past either end.
    const rows = await tx.$queryRaw`
      UPDATE "Character"
      SET "mood" = LEAST(${MOOD_MAX}::double precision, GREATEST(${MOOD_MIN}::double precision, "mood" + ${delta}::double precision))
      WHERE "id" = ${characterId}
      RETURNING "mood"`;
    after = clampMood(Number(rows?.[0]?.mood ?? before + delta));
  }

  const previousBand = bandOf(before);
  const band = bandOf(after);
  let dm = null;
  if (character.status === "ALIVE" && character.discordUserId) {
    const content = moodBandDm(previousBand, band);
    if (content) dm = { discordUserId: character.discordUserId, content };
  }
  if (dm && notify) scheduleMoodDm(dm);

  return {
    characterId,
    before,
    after,
    delta: Math.round((after - before) * 100) / 100,
    moveApplied,
    restorativeApplied,
    band,
    previousBand,
    dm,
  };
}

// One event. `base` may be omitted for the kinds EVENTS knows.
async function applyMood(tx, characterId, { kind, base = EVENTS[kind], ctx = {}, intensity = null, notify = true } = {}) {
  return applyMoodTerms(tx, characterId, [{ kind, base, ctx }], { intensity, notify });
}

// A kiss, rationed (docs/systemdocs/KISS.md). Worth the same as a confession
// and, like the Cathedral two blocks down, worth it ONCE a turn per person —
// so a pair who kiss all afternoon lift each other one band, not eight.
//
// The ration is an AuditLog row rather than a column pair: a once-a-turn gate
// needs no migration, and the row is already worth writing. (MOVE_MOOD_TURN_CAP's
// heavier machinery earns itself on movement, where a dozen small steps have to
// part-spend one allowance.) It cannot be a magnitude cap instead, and that is
// firmer since `bonus` arrived — a Seductive kiss is worth several times
// EVENTS.KISS on its own, so a cap sized to one kiss would silently eat it.
//
// `bonus` is the PARTNER's appearance, added to the base: a fact about the
// person doing the kissing, paid to the person being kissed. The table and the
// arithmetic live in db/lib/kiss.js#appearanceBonus — this only has to add it,
// so the mood tables stay the record of what an EVENT is worth and nothing
// else has to know that Pretty exists.
//
// Returns the applyMood result, or null when the ration is already spent —
// which is not a failure. The caller still posts its scene line; a kiss that
// moves no dial is a kiss that happened.
const KISS_AUDIT_ACTION = "mood_kissed";

async function applyKissMood(tx, characterId, { turnId, partnerId = null, bonus = 0 } = {}) {
  // No open turn means nothing to ration against, the answer applyArrivalMood
  // gives itself: it charges in full.
  if (turnId) {
    const already = await tx.auditLog.count({
      where: { actionType: KISS_AUDIT_ACTION, turnId, targetCharacterId: characterId },
    });
    if (already > 0) return null;
  }
  const result = await applyMood(tx, characterId, { kind: "KISS", base: EVENTS.KISS + (Number(bonus) || 0) });
  if (turnId) {
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: "system",
        actionType: KISS_AUDIT_ACTION,
        targetCharacterId: characterId,
        turnId,
        details: { partnerId },
      },
    });
  }
  return result;
}

// Sets the dial outright, ignoring the tables — the Rite of Panic's hammer,
// and nothing else. Still reports the band change, so the DM rule is the one
// every other path uses.
async function setMood(tx, characterId, value, { notify = true } = {}) {
  const character = await tx.character.findUnique({
    where: { id: characterId },
    select: { id: true, status: true, mood: true, discordUserId: true },
  });
  if (!character) return null;
  const after = clampMood(value);
  await tx.character.update({ where: { id: characterId }, data: { mood: after } });
  const previousBand = bandOf(character.mood ?? 0);
  const band = bandOf(after);
  let dm = null;
  if (character.status === "ALIVE" && character.discordUserId) {
    const content = moodBandDm(previousBand, band);
    if (content) dm = { discordUserId: character.discordUserId, content };
  }
  if (dm && notify) scheduleMoodDm(dm);
  return { characterId, before: character.mood ?? 0, after, band, previousBand, dm };
}

// "These CharacterTag rows just LANDED on this sheet." Re-reads the tags and
// charges WOUND harm for each one in a wound group by its rung, and DYING for
// the dying tag; anything else is a no-op. Call it only for rows that were
// actually created — a stack increment or an already-held tag is not a new
// wound. Safe with an empty list; returns null when nothing hurt.
async function applyWoundMood(tx, characterId, tagIds, opts = {}) {
  const ids = [...new Set((tagIds ?? []).filter(Boolean))];
  if (!ids.length) return null;
  // Filtered in the query, because this runs on EVERY new tag row — a sheet
  // of paper must cost one indexed read that says no, not a sheet load.
  const tags = await tx.tag.findMany({
    where: { id: { in: ids }, OR: [{ slug: DYING_SLUG }, { group: { slug: { in: [...WOUND_GROUPS] } } }] },
    select: {
      id: true,
      slug: true,
      category: true,
      requirementResources: true,
      requirementTurns: true,
      requirementPerTurn: true,
      requirementGambit: true,
      group: { select: { slug: true } },
    },
  });
  const terms = [];
  for (const tag of tags) {
    if (tag.slug === DYING_SLUG) {
      terms.push({ kind: "DYING", base: EVENTS.DYING });
      continue;
    }
    const base = woundMoodFor(tag);
    if (base < 0) terms.push({ kind: "WOUND", base, ctx: { burn: BURN_SLUGS.has(tag.slug) } });
  }
  if (!terms.length) return null;
  return applyMoodTerms(tx, characterId, terms, opts);
}

// What walking somewhere costs, or earns: a little for open country or the
// dark (arrivalTermFor), and +10 for stepping into the Cathedral, once per
// character per turn — the ration is an AuditLog row with turnId set, the
// REQUESTS.md §1a pattern, and a rare one. A first placement (creation, a
// spawn, a GM dropping somebody in from nowhere) has no `from` and charges
// nothing: nobody walked. Takes the singleton client; opens its own tx.
const CATHEDRAL_LOCATION_SLUG = "cathedral";
const CATHEDRAL_AUDIT_ACTION = "mood_cathedral";
async function applyArrivalMood(prisma, { characterId, fromLocationId, toLocationId }) {
  if (!characterId || !toLocationId || !fromLocationId || fromLocationId === toLocationId) return null;
  const location = await prisma.location.findUnique({
    where: { id: toLocationId },
    select: { id: true, slug: true, indoors: true, attributes: true, zone: { select: { kind: true } } },
  });
  if (!location) return null;
  const terms = [];
  const arrival = arrivalTermFor(location);
  if (arrival) terms.push(arrival);

  // One lookup, two users: the Cathedral's once-a-turn relief and the
  // movement ration below both need the open turn.
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });

  if (location.slug === CATHEDRAL_LOCATION_SLUG && openTurn) {
    const already = await prisma.auditLog.count({
      where: { actionType: CATHEDRAL_AUDIT_ACTION, turnId: openTurn.id, targetCharacterId: characterId },
    });
    if (already === 0) {
      terms.push({ kind: "CATHEDRAL", base: EVENTS.CATHEDRAL, capAtFine: true });
      await prisma.auditLog.create({
        data: {
          actorDiscordUserId: "system",
          actionType: CATHEDRAL_AUDIT_ACTION,
          targetCharacterId: characterId,
          turnId: openTurn.id,
          details: { locationId: location.id },
        },
      });
    }
  }
  if (!terms.length) return null;

  // Between turns there is nothing to ration against, so a move charges in
  // full — the same answer the Cathedral gives itself two blocks up.
  const rationed = openTurn != null && terms.some((t) => t.move);

  return prisma.$transaction(async (tx) => {
    if (!rationed) return applyMoodTerms(tx, characterId, terms);

    const character = await tx.character.findUnique({ where: { id: characterId }, select: MOOD_CHARACTER_SELECT });
    if (!character) return null;
    const spent = character.moveMoodTurnId === openTurn.id ? character.moveMoodUsed ?? 0 : 0;

    const result = await applyMoodTerms(tx, characterId, terms, {
      character,
      moveCapRemaining: MOVE_MOOD_TURN_CAP - spent,
    });

    if (result?.moveApplied > 0) {
      // Guarded exactly like the free-move counter in locationTravel.js: the
      // WHERE re-states what was read, so two arrivals landing in the same
      // tick cannot both spend the same remainder.
      await tx.character.updateMany({
        where:
          character.moveMoodTurnId === openTurn.id
            ? { id: characterId, moveMoodTurnId: openTurn.id, moveMoodUsed: spent }
            : { id: characterId, OR: [{ moveMoodTurnId: null }, { moveMoodTurnId: { not: openTurn.id } }] },
        data: { moveMoodTurnId: openTurn.id, moveMoodUsed: spent + result.moveApplied },
      });
    }
    return result;
  });
}

// What one consume is worth. An item with its OWN entry is authoritative —
// that number is what the item is, and it wins outright, sign and all. A
// negative entry (Moldy Bread, Grasshopper Kebab: bad ration-box food, all
// of them also `consumesInto: [ate-meal]`) has to actually land negative
// rather than being swallowed by ate-meal's +5 floor. An item with no entry
// of its own falls back to the largest figure among what it granted — most
// drinks are keyed on the STATUS they grant (Coffee has no entry; its relief
// comes from Caffeinated's) rather than the item itself. 0 for a stew.
// The two that SET the dial instead of moving it. "Instantly Ecstatic" is not
// a delta: a character at -50 given +82 lands at +32, nowhere near the band.
// consumeTagRequest checks this before it reaches consumeReliefFor.
//
// Changa is on the list as well as carrying the changa-high pin, because the
// pin only fires on the nightly pass -- without this, the first evening of a
// high would not feel like one.
const MOOD_MAX_CONSUMABLES = new Set(["heroin", "changa"]);

function consumeSetsMoodToMax(itemSlug) {
  return MOOD_MAX_CONSUMABLES.has(itemSlug);
}

function consumeReliefFor(itemSlug, grantedSlugs = []) {
  if (itemSlug in CONSUME_RELIEF) return CONSUME_RELIEF[itemSlug];
  let best = 0;
  for (const slug of grantedSlugs) best = Math.max(best, CONSUME_RELIEF[slug] ?? 0);
  return best;
}

// What a COOKED DISH is worth (docs/systemdocs/COOKING.md): the meal's own
// small figure plus every ingredient's, as terms for applyMoodTerms.
//
// Three deliberate differences from consumeReliefFor above, each of which is
// the reason this is a separate function rather than another branch of it:
//
//   It SUMS. A drink is one drink however many statuses it lands, but "the
//   ingredient does most of the work" only means anything if a second slot
//   adds to the first. Two delicacies in a Lavish Meal are worth both.
//
//   It can be NEGATIVE. Relief is a max over a table of positives; a dish
//   made of feces is the worst thing in the game and has to be able to say so.
//
//   It returns the two halves SEPARATELY, never netted. Only harm is ever
//   scaled — by k, and by the multiplier stack — so netting +45 of saffron
//   against -55 of feces first would quietly charge the eater a scaled -10
//   instead of an unscaled +45 and a scaled -55. They are two things that
//   happened at one meal, not one thing.
//
// DISGUST carries noMultiplier, the way DRIFT does. Three of the rules in
// MULTIPLIERS apply to `kinds: "*"`, and while "Brave halves your disgust at
// eating a liver" is arguable, "the Rite of Rage makes feces free" and
// "holding the right sword makes you immune to disgust" are not. Revulsion at
// what you just swallowed is not a fright, and nothing in the fright table
// has an opinion about it.
function dishMoodTerms(mealMood, ingredientMoods = []) {
  const moods = ingredientMoods.filter((m) => Number.isFinite(m));
  const relief = (mealMood ?? 0) + moods.filter((m) => m > 0).reduce((a, m) => a + m, 0);
  const harm = moods.filter((m) => m < 0).reduce((a, m) => a + m, 0);
  const terms = [];
  if (relief) terms.push({ kind: "MEAL", base: relief });
  if (harm) terms.push({ kind: "DISGUST", base: harm, noMultiplier: true });
  return terms;
}

module.exports = {
  // Tables and pure functions: the turn pass, the hooks and the test read these.
  MOOD_BANDS,
  MOOD_MAX,
  MOOD_MIN,
  MOOD_DRIFT_UP,
  MOOD_DRIFT_DOWN,
  PLACE_TERMS,
  MOVE_MOOD_TURN_CAP,
  EVENTS,
  DESIRE_RELIEF_PER_POINT,
  MULTIPLIER_SLUGS,
  clampMood,
  bandOf,
  placeClassOf,
  placeTermFor,
  driftTermFor,
  restorativeRoom,
  arrivalTermFor,
  woundRungOf,
  woundMoodFor,
  multiplierFor,
  resolveDelta,
  moodBandDm,
  consumeReliefFor,
  setMoodDmSender,
  loadIntensity,
  applyMoodTerms,
  applyMood,
  dishMoodTerms,
  applyKissMood,
  KISS_AUDIT_ACTION,
  setMood,
  consumeSetsMoodToMax,
  applyWoundMood,
  applyArrivalMood,
};
