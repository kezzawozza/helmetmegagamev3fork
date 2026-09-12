// node --test over the pure half of db/lib/mood.js — the band table, the wound
// rungs, the multiplier stack, the drift and the coefficient. Run with
// `npm test --workspace=db`. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MOOD_BANDS,
  MOOD_MAX,
  MOOD_MIN,
  MOOD_DRIFT_UP,
  MOOD_DRIFT_DOWN,
  PLACE_TERMS,
  EVENTS,
  bandOf,
  placeClassOf,
  placeTermFor,
  driftTermFor,
  restorativeRoom,
  arrivalTermFor,
  MOVE_MOOD_TURN_CAP,
  woundRungOf,
  woundMoodFor,
  multiplierFor,
  resolveDelta,
  clampMood,
  moodBandDm,
  consumeReliefFor,
} = require("../lib/mood");

const wound = (extra = {}) => ({
  slug: "x",
  category: "health",
  group: { slug: "health-wounds" },
  requirementResources: null,
  requirementTurns: null,
  requirementGambit: false,
  ...extra,
});

// applyMoodTerms' arithmetic without Prisma: resolve every term at k = 1, then
// let the restorative ones fill whatever hole is left — up to Fine, no further.
// Terms may be null (driftTermFor returns null at 0), same as the real caller.
function settle(before, terms, heldSlugs = []) {
  let other = 0;
  let restorative = 0;
  for (const term of terms) {
    if (!term || !term.base) continue;
    const resolved = resolveDelta({ ...term, heldSlugs });
    if (term.capAtFine) restorative += resolved;
    else other += resolved;
  }
  const applied = restorative > 0 ? Math.min(restorative, restorativeRoom(before, other)) : 0;
  return clampMood(before + other + applied);
}

test("ten bands, gapless and symmetric about Fine but for Panicking", () => {
  assert.equal(MOOD_BANDS.length, 10);
  for (let i = 1; i < MOOD_BANDS.length; i += 1) {
    assert.equal(MOOD_BANDS[i].min, MOOD_BANDS[i - 1].max);
  }
  // The steps out from Fine are the same magnitudes in both directions, as far
  // as the good half goes: Panicking is the one band with nothing facing it.
  const negative = MOOD_BANDS.filter((b) => b.max <= -10).map((b) => -b.max);
  const positive = MOOD_BANDS.filter((b) => b.min >= 10).map((b) => b.min);
  assert.deepEqual(negative.sort((a, b) => a - b), [10, 28, 46, 64, 82]);
  assert.deepEqual(positive.sort((a, b) => a - b), [10, 28, 46, 64]);
});

test("a mood always has a word, and 0 is Fine", () => {
  assert.equal(bandOf(0).label, "Fine");
  assert.equal(bandOf(9.99).label, "Fine");
  assert.equal(bandOf(-9.99).label, "Fine");
  assert.equal(bandOf(null).label, "Fine");
});

test("the boundary belongs to the further band, both ways", () => {
  assert.equal(bandOf(-10).key, "uncomfortable");
  assert.equal(bandOf(-28).key, "stressed");
  assert.equal(bandOf(-46).key, "anxious");
  assert.equal(bandOf(-64).key, "afraid");
  assert.equal(bandOf(-82).key, "panicking");
  assert.equal(bandOf(-100).key, "panicking");
  assert.equal(bandOf(10).key, "content");
  assert.equal(bandOf(28).key, "pleased");
  assert.equal(bandOf(46).key, "happy");
  assert.equal(bandOf(63.99).key, "happy");
  assert.equal(bandOf(64).key, "ecstatic");
  // The clamp itself is Ecstatic, the way −100 is Panicking.
  assert.equal(bandOf(82).key, "ecstatic");
});

test("only the three extreme bands touch the dice, and Ecstatic points up", () => {
  assert.equal(bandOf(-90).gambit, -2);
  assert.equal(bandOf(-70).gambit, -1);
  assert.equal(bandOf(70).gambit, 1);
  // Ecstatic is Afraid's mirror: same magnitude, opposite sign.
  assert.equal(bandOf(70).gambit, -bandOf(-70).gambit);
  for (const mood of [-50, -30, -12, 0, 12, 30, 50, 63.99]) {
    assert.ok(!bandOf(mood).gambit, `mood ${mood} should not modify a Gambit`);
  }
});

test("the dial clamps to +82 … −100", () => {
  assert.equal(clampMood(-140), MOOD_MIN);
  assert.equal(clampMood(90), MOOD_MAX);
  assert.equal(clampMood(-33.333), -33.33);
  assert.equal(clampMood(undefined), 0);
});

test("the drift pulls toward Fine from both sides, slowly up and fast down", () => {
  assert.equal(driftTermFor(0), null);
  assert.equal(driftTermFor(-50).base, MOOD_DRIFT_UP);
  assert.equal(driftTermFor(50).base, -MOOD_DRIFT_DOWN);
  // A mood inside one step of Fine lands exactly on it, from either side.
  assert.equal(driftTermFor(-2).base, 2);
  assert.equal(driftTermFor(2).base, -2);
  assert.equal(driftTermFor(30).base, -30);
  assert.equal(driftTermFor(-50).noMultiplier, true);
});

test("the ceiling is three nights from Fine, and the floor is twenty-five", () => {
  const nights = (start) => {
    let mood = start;
    let n = 0;
    for (; mood !== 0 && n < 100; n += 1) mood = settle(mood, [driftTermFor(mood)]);
    return n;
  };
  assert.equal(nights(MOOD_MAX), 3);
  assert.equal(nights(MOOD_MIN), 25);
});

test("the drift down from a good mood is not a fright, so no tag scales it", () => {
  const brave = ["brave"];
  const down = driftTermFor(40);
  assert.equal(resolveDelta({ ...down, heldSlugs: brave }), -MOOD_DRIFT_DOWN);
  // ...whereas an actual fright is halved.
  assert.equal(resolveDelta({ kind: "WOUND", base: -30, heldSlugs: brave }), -15);
});

test("wound rungs read the cure ladder, and a wound is signed negative", () => {
  assert.equal(woundRungOf(wound()), 0);
  assert.equal(woundRungOf(wound({ requirementResources: 0 })), 0.5);
  assert.equal(woundRungOf(wound({ requirementResources: 1 })), 1);
  assert.equal(woundRungOf(wound({ requirementResources: 2 })), 2);
  // The four 2-⬢ shapes since M2a (turnsCost repricing put Simple and
  // Moderate on the same requirementResources: 2/requirementTurns: 1 shape,
  // differing only in requirementPerTurn — db/lib/mood.js's woundRungOf):
  // legacy zero-turn, the new Simple (1/4), the new Moderate (1/3), and a
  // GM-authored whole turn (the Dev Panel form cannot author a fraction, so
  // it lands with a null denominator). Only the new Simple may stay at rung
  // 2 alongside the legacy zero-turn case; everything else with a nonzero
  // turn cost stays rung 3, exactly as it did before this milestone.
  assert.equal(woundRungOf(wound({ requirementResources: 2, requirementTurns: 0 })), 2);
  assert.equal(
    woundRungOf(wound({ requirementResources: 2, requirementTurns: 1, requirementPerTurn: 4 })),
    2,
  );
  assert.equal(
    woundRungOf(wound({ requirementResources: 2, requirementTurns: 1, requirementPerTurn: 3 })),
    3,
  );
  assert.equal(
    woundRungOf(wound({ requirementResources: 2, requirementTurns: 1, requirementPerTurn: null })),
    3,
  );
  assert.equal(woundRungOf(wound({ requirementResources: 2, requirementTurns: 1 })), 3);
  assert.equal(woundRungOf(wound({ requirementResources: 3 })), 3.5);
  assert.equal(woundRungOf(wound({ requirementResources: 5 })), 4);
  assert.equal(woundRungOf(wound({ requirementResources: 8 })), 6);
  assert.equal(woundRungOf(wound({ requirementGambit: true })), 7);
  // A cold is not a wound.
  assert.equal(woundRungOf(wound({ group: { slug: "health-illness" } })), null);

  assert.equal(woundMoodFor(wound({ requirementResources: 2, requirementTurns: 1 })), -30);
  assert.equal(woundMoodFor(wound()), 0);
  assert.equal(woundMoodFor(wound({ group: { slug: "health-minor" } })), 0);
});

test("multipliers are a product, and a 0 anywhere wins", () => {
  assert.equal(multiplierFor("WILDERNESS", ["brave", "rough-camper"]), 0.25);
  assert.equal(multiplierFor("WILDERNESS", ["rough-camper", "agoraphobia"]), 1);
  assert.equal(multiplierFor("CAVE", ["pale", "claustrophobia"]), 1);
  assert.equal(multiplierFor("WILDERNESS", ["outsider", "agoraphobia", "brave"]), 0);
  // Pyrophobia only bites on a burn.
  assert.equal(multiplierFor("WOUND", ["pyrophobia"], { burn: true }), 3);
  assert.equal(multiplierFor("WOUND", ["pyrophobia"], { burn: false }), 1);
  // An equipped-conditional rule needs the equipped list to fire at all.
  assert.equal(multiplierFor("WOUND", ["heartforged-blade"]), 1);
  assert.equal(multiplierFor("WOUND", ["heartforged-blade"], {}, ["heartforged-blade"]), 0);
});

test("harm scales by k, relief divides by it, and k=0 is the off switch", () => {
  assert.equal(resolveDelta({ kind: "WOUND", base: -30, heldSlugs: [], intensity: 2 }), -60);
  assert.equal(resolveDelta({ kind: "DRINK", base: 30, heldSlugs: [], intensity: 2 }), 15);
  // Relief is never scaled by a tag, however brave you are.
  assert.equal(resolveDelta({ kind: "DRINK", base: 30, heldSlugs: ["brave"] }), 30);
  assert.equal(resolveDelta({ kind: "WOUND", base: -30, heldSlugs: [], intensity: 0 }), 0);
  assert.equal(resolveDelta({ kind: "DRINK", base: 30, heldSlugs: [], intensity: 0 }), 0);
});

test("place classes: a haven beats its own roof, a safe cave is a room", () => {
  assert.equal(placeClassOf(null), "OPEN");
  assert.equal(placeClassOf({ attributes: { haven: true }, indoors: true }), "HAVEN");
  assert.equal(placeClassOf({ indoors: true }), "INDOORS");
  assert.equal(placeClassOf({ attributes: { wilderness: true } }), "WILDERNESS");
  assert.equal(placeClassOf({ zone: { kind: "CAVE_LEVEL" } }), "CAVE");
  assert.equal(placeClassOf({ zone: { kind: "CAVE_LEVEL" }, attributes: { safe: true } }), "INDOORS");
  assert.equal(placeClassOf({}), "OPEN");
});

test("a night somewhere: harm keeps its kind, comfort is plain PLACE and caps at Fine", () => {
  // Harm carries its own kind so Rough Camper and the phobias can find it, and
  // takes no cap — a bad night is a bad night however happy you were.
  assert.deepEqual(placeTermFor("CAVE"), { kind: "CAVE", base: PLACE_TERMS.CAVE });
  assert.deepEqual(placeTermFor("WILDERNESS"), { kind: "WILDERNESS", base: PLACE_TERMS.WILDERNESS });
  // All three comforts collapse to one kind and all three only ever mend.
  assert.deepEqual(placeTermFor("HAVEN"), { kind: "PLACE", base: PLACE_TERMS.HAVEN, capAtFine: true });
  assert.deepEqual(placeTermFor("INDOORS"), { kind: "PLACE", base: PLACE_TERMS.INDOORS, capAtFine: true });
  assert.deepEqual(placeTermFor("OPEN"), { kind: "PLACE", base: PLACE_TERMS.OPEN, capAtFine: true });
});

// The designer's three checks, walked with the signs the mood dial uses.
test("seven wilderness walks and a night out land a character Uncomfortable", () => {
  const steps = 7 * EVENTS.WILDERNESS_MOVE;
  assert.equal(steps, -14);
  assert.equal(bandOf(steps).key, "uncomfortable");
  const night = steps + PLACE_TERMS.WILDERNESS + driftTermFor(steps).base;
  assert.equal(night, -20);
  assert.equal(bandOf(night).key, "uncomfortable");

  // A moderately severe wound on top of that is Anxious.
  const hurt = night + woundMoodFor(wound({ requirementResources: 2, requirementTurns: 1 }));
  assert.equal(hurt, -50);
  assert.equal(bandOf(hurt).key, "anxious");
});

test("two nights indoors clear a −20, and one in a Haven does better", () => {
  // Through settle() rather than by adding the constants up: neither of these
  // crosses 0, so the cap never bites, but it has to be the cap's arithmetic
  // saying so and not a sum that would agree no matter what the cap did.
  const night = (mood, cls) => settle(mood, [placeTermFor(cls), driftTermFor(mood)]);
  let mood = -20;
  for (let i = 0; i < 2; i += 1) mood = night(mood, "INDOORS");
  assert.equal(mood, 0);
  assert.equal(bandOf(mood).label, "Fine");
  assert.equal(PLACE_TERMS.INDOORS + MOOD_DRIFT_UP, 10);

  // A haven does it in one: −20 is Uncomfortable, and one night there is not.
  const haven = night(-20, "HAVEN");
  assert.equal(haven, -4);
  assert.equal(bandOf(haven).label, "Fine");
});

test("shelter fills the hole and stops at Fine", () => {
  assert.equal(restorativeRoom(-20), 20);
  // The room is measured against everything else the same write does, so the
  // answer cannot depend on the order the terms were pushed.
  assert.equal(restorativeRoom(-20, 4), 16);
  // Harm the same night deepens the hole, so the bed fills more of it.
  assert.equal(restorativeRoom(-5, -5), 10);
  // Nothing left to fill: already Fine, already happy, or carried past Fine by
  // something that is not shelter.
  assert.equal(restorativeRoom(0), 0);
  assert.equal(restorativeRoom(40), 0);
  assert.equal(restorativeRoom(-20, 30), 0);
  // A missing reading is 0, never NaN.
  assert.equal(restorativeRoom(undefined), 0);
  assert.equal(restorativeRoom(null, null), 0);
});

test("a bed never makes anybody happy, however many nights they sleep in one", () => {
  const night = (mood) => settle(mood, [placeTermFor("HAVEN"), driftTermFor(mood)]);
  // The whole reason the rule exists: +12 a night against a −4 drift used to
  // net +8, carrying somebody from Fine to the ceiling in about ten nights and
  // handing them a standing +1 Gambit for the price of a bed.
  let mood = 0;
  for (let i = 0; i < 30; i += 1) mood = night(mood);
  assert.equal(mood, 0);
  assert.equal(bandOf(mood).label, "Fine");

  // Somebody already above Fine only drifts back down, and the bed does not
  // slow the fall — a good mood is spent by morning either way.
  assert.equal(night(40), 0);
  assert.equal(night(60), 20);
  assert.equal(night(4), 0);

  // Recovery from a bad mood is untouched — the full +16 still lands.
  assert.equal(night(-50), -34);
});

test("a good bed absorbs the night's hunger and lands exactly on Fine", () => {
  const hungry = { kind: "HUNGER", base: EVENTS.HUNGER };
  assert.equal(settle(-5, [placeTermFor("HAVEN"), driftTermFor(-5), hungry]), 0);

  // A fulfilled Desire is not shelter, so it carries past Fine on its own —
  // and the bed adds nothing on top of it.
  const desire = { kind: "DESIRE", base: 30 };
  assert.equal(settle(-20, [placeTermFor("HAVEN"), driftTermFor(-20), desire]), 14);
  assert.equal(bandOf(14).label, "Content");

  // The Cathedral is a place like any other: it mends, it does not elate.
  const cathedral = { kind: "CATHEDRAL", base: EVENTS.CATHEDRAL, capAtFine: true };
  assert.equal(settle(-5, [cathedral]), 0);
  assert.equal(settle(20, [cathedral]), 20);
});

test("the movement ration pools only move terms, and floors at −15", () => {
  assert.equal(MOVE_MOOD_TURN_CAP, 15);
  assert.equal(arrivalTermFor({ attributes: { wilderness: true } }).move, true);
  assert.equal(arrivalTermFor({ attributes: { wilderness: true } }).base, EVENTS.WILDERNESS_MOVE);
  assert.equal(arrivalTermFor({ zone: { kind: "CAVE_LEVEL" } }).base, EVENTS.CAVE_MOVE);
  // Somewhere that costs nothing to walk into gives no term at all.
  assert.equal(arrivalTermFor({ indoors: true }), null);
  assert.equal(arrivalTermFor({ attributes: { haven: true } }), null);
});

test("only the three bands that move a Gambit say anything, and only on the way in", () => {
  const fine = bandOf(0);
  const uncomfortable = bandOf(-20);
  const afraid = bandOf(-70);
  const panicking = bandOf(-90);
  const happy = bandOf(50);
  const ecstatic = bandOf(70);

  assert.equal(moodBandDm(fine, afraid), "You are now Afraid.");
  assert.equal(moodBandDm(afraid, panicking), "You are now Panicking.");
  // The good end talks on the same rule, because it moves the die too.
  assert.equal(moodBandDm(happy, ecstatic), "You are now Ecstatic.");
  // Everything else is silent: the six other bands, in either direction.
  assert.equal(moodBandDm(fine, uncomfortable), null);
  assert.equal(moodBandDm(uncomfortable, fine), null);
  assert.equal(moodBandDm(fine, happy), null);
  // ...and so is climbing back out of any of the three that do talk. Falling
  // out of Ecstatic needs no code of its own: Happy is not a key, so the
  // existing "only on the way in" rule already covers it.
  assert.equal(moodBandDm(afraid, uncomfortable), null);
  assert.equal(moodBandDm(panicking, fine), null);
  assert.equal(moodBandDm(ecstatic, happy), null);
  // Staying put says nothing either.
  assert.equal(moodBandDm(afraid, afraid), null);
  assert.equal(moodBandDm(ecstatic, ecstatic), null);
});

test("a consume is worth its largest single figure, never a sum", () => {
  // Bliss lands two statuses and is one drink.
  assert.equal(consumeReliefFor("bliss", ["euphoric", "high"]), 30);
  // A treat is a treat, not a treat plus a meal.
  assert.equal(consumeReliefFor("sweets", ["ate-meal"]), 8);
  assert.equal(consumeReliefFor("honeyed-cakes", ["ate-meal"]), 8);
  assert.equal(consumeReliefFor("coffee", ["caffeinated"]), 15);
  assert.equal(consumeReliefFor("sky-lantern", []), 8);
  // Any proper meal at all is the floor under the food.
  assert.equal(consumeReliefFor("trail-ration", ["ate-meal"]), 5);
  // And a plain thing is worth nothing.
  assert.equal(consumeReliefFor("stepstone", []), 0);
});

test("a cooked meal is priced by dishMoodTerms, not by this table", () => {
  // The two rows that used to sit here are gone: a dish is a minted row, so
  // its slug never matches a table keyed by slug (COOKING.md). Both fall
  // through to the ate-meal floor if anything ever asks.
  assert.equal(consumeReliefFor("fine-meal", ["ate-meal", "dined"]), 5);
  assert.equal(consumeReliefFor("lavish-meal", ["ate-meal", "dined"]), 5);
});
