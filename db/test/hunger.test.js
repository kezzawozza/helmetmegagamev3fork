// node --test over db/lib/hunger.js. Pure and Prisma-free, same as the module
// it covers. The two things most likely to go wrong silently: a single turn's
// decay crossing BOTH bands at once (must charge the onset mood hit once, not
// twice), and foodHungerFor's three-way fallback (mealHunger > cooked.hunger
// > DEFAULT_FOOD_HUNGER-if-still-food > 0).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HUNGER_MAX,
  HUNGRY_THRESHOLD,
  STARVING_THRESHOLD,
  DEFAULT_FOOD_HUNGER,
  RAW_FOOD_MOOD,
  clampHunger,
  bandOf,
  decayFor,
  crossings,
  foodHungerFor,
  rawFoodMoodTerms,
  hungerDm,
} = require("../lib/hunger");

test("clampHunger holds the meter inside 0-30", () => {
  assert.equal(clampHunger(-5), 0);
  assert.equal(clampHunger(0), 0);
  assert.equal(clampHunger(30), 30);
  assert.equal(clampHunger(33), HUNGER_MAX);
  assert.equal(clampHunger(28.4), 28);
});

test("bandOf reads the two thresholds, Starving first", () => {
  assert.equal(bandOf(30), "fed");
  assert.equal(bandOf(HUNGRY_THRESHOLD + 1), "fed");
  assert.equal(bandOf(HUNGRY_THRESHOLD), "hungry");
  assert.equal(bandOf(1), "hungry");
  assert.equal(bandOf(STARVING_THRESHOLD), "starving");
  assert.equal(bandOf(-5), "starving");
});

test("decayFor: hungerless never decays, Fast Metabolism doubles it, hungerless wins if both held", () => {
  assert.equal(decayFor([]), 3);
  assert.equal(decayFor(["fast-metabolism"]), 6);
  assert.equal(decayFor(["hungerless"]), 0);
  assert.equal(decayFor(["hungerless", "fast-metabolism"]), 0);
  assert.equal(decayFor(new Set(["fast-metabolism"])), 6);
});

test("crossings: entering a band only fires on the turn that actually crosses it", () => {
  assert.deepEqual(crossings(13, 10), {
    enteredHungry: true,
    enteredStarving: false,
    leftHungry: false,
    leftStarving: false,
  });
  // Still hungry, nothing new.
  assert.deepEqual(crossings(10, 7), {
    enteredHungry: false,
    enteredStarving: false,
    leftHungry: false,
    leftStarving: false,
  });
  assert.deepEqual(crossings(2, -1), {
    enteredHungry: false,
    enteredStarving: true,
    leftHungry: false,
    leftStarving: false,
  });
});

test("crossings: a single turn's decay crossing BOTH bands fires BOTH, not a double charge for one", () => {
  const c = crossings(13, -2);
  assert.equal(c.enteredHungry, true);
  assert.equal(c.enteredStarving, true);
  // The caller (hungerPass.js) charges one onset hit per true flag here — two
  // flags means two DISTINCT onset kinds (HUNGRY_ONSET + STARVING_ONSET), not
  // the same -30 applied twice for one crossing.
});

test("crossings: leaving a band on eating", () => {
  assert.deepEqual(crossings(0, 12), {
    enteredHungry: false,
    enteredStarving: false,
    leftHungry: true,
    leftStarving: true,
  });
});

test("foodHungerFor: mealHunger wins outright over cooked.hunger", () => {
  assert.equal(foodHungerFor({ mealHunger: 6, cooked: { hunger: 2 } }), 6);
});

test("foodHungerFor: falls back to cooked.hunger when there's no mealHunger", () => {
  assert.equal(foodHungerFor({ cooked: { hunger: 4 } }), 4);
});

test("foodHungerFor: falls back to DEFAULT_FOOD_HUNGER for an unpriced tag that still grants ate-meal", () => {
  assert.equal(foodHungerFor({ consumesInto: ["ate-meal"] }), DEFAULT_FOOD_HUNGER);
});

test("foodHungerFor: 0 for anything that is not food at all", () => {
  assert.equal(foodHungerFor({ consumesInto: [] }), 0);
  assert.equal(foodHungerFor({}), 0);
  assert.equal(foodHungerFor(null), 0);
});

test("foodHungerFor: cooked.hunger of 0 is a real, explicit value, not 'absent'", () => {
  assert.equal(foodHungerFor({ cooked: { hunger: 0 } }), 0);
});

test("rawFoodMoodTerms: a positive cooked.mood adds a MEAL term on top of the flat raw penalty", () => {
  const terms = rawFoodMoodTerms(20);
  assert.equal(terms.length, 2);
  assert.deepEqual(terms[0], { kind: "RAW_FOOD", base: RAW_FOOD_MOOD, noMultiplier: true });
  assert.deepEqual(terms[1], { kind: "MEAL", base: 20 });
  assert.equal(terms.reduce((s, t) => s + t.base, 0), 10);
});

test("rawFoodMoodTerms: a negative cooked.mood adds a DISGUST term, also noMultiplier", () => {
  const terms = rawFoodMoodTerms(-5);
  assert.equal(terms.length, 2);
  assert.deepEqual(terms[1], { kind: "DISGUST", base: -5, noMultiplier: true });
  assert.equal(terms.reduce((s, t) => s + t.base, 0), -15);
});

test("rawFoodMoodTerms: zero/absent cooked.mood is just the flat raw penalty, one term", () => {
  assert.equal(rawFoodMoodTerms(0).length, 1);
  assert.equal(rawFoodMoodTerms(undefined).length, 1);
});

test("hungerDm: no line ever names a number, per the design doc", () => {
  for (const kind of ["hungry", "starving", "recovered"]) {
    const dm = hungerDm({ kind });
    assert.equal(typeof dm, "string");
    assert.equal(/\d/.test(dm), false, `hungerDm("${kind}") should not contain a digit: "${dm}"`);
  }
});

test("hungerDm: an unrecognized kind returns null rather than throwing", () => {
  assert.equal(hungerDm({ kind: "something-else" }), null);
});
