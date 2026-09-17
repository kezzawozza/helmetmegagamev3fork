// node --test over db/lib/gambitModifier.js. This file had no coverage until
// the mood rework, and it is the one place where a missed argument goes wrong
// SILENTLY: the Afraid and Panicking penalties used to be read off tag slugs
// and are now read off Character.mood, so a call site that forgets to pass
// (or select) `mood` quietly hands somebody back a penalty they should be
// carrying. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const { gambitModifiers, gambitModifierTotal, formatGambitModifiers } = require("../lib/gambitModifier");

const hungry = [{ tag: { slug: "hungry" } }];
const starving = [{ tag: { slug: "starving" } }];
// A Starving character holds BOTH tags at once (db/lib/hunger.js's
// HUNGRY_THRESHOLD/STARVING_THRESHOLD) — this is the shape a real sheet
// hands in, not an edge case nobody hits.
const starvingAndHungry = [{ tag: { slug: "hungry" } }, { tag: { slug: "starving" } }];

test("the two bottom mood bands are the only ones that cost dice", () => {
  assert.equal(gambitModifierTotal([], { mood: -90 }), -2);
  assert.equal(gambitModifierTotal([], { mood: -82 }), -2);
  assert.equal(gambitModifierTotal([], { mood: -70 }), -1);
  assert.equal(gambitModifierTotal([], { mood: -64 }), -1);
  assert.equal(gambitModifierTotal([], { mood: -63.99 }), 0);
});

test("a merely good mood is flavour — Content, Pleased and Happy roll the same", () => {
  for (const mood of [0, 10, 28, 46, 63.99]) {
    assert.equal(gambitModifierTotal([], { mood }), 0, `mood ${mood} should not modify a Gambit`);
  }
});

test("Ecstatic is the one band that HANDS a die back", () => {
  assert.equal(gambitModifierTotal([], { mood: 82 }), 1);
  assert.equal(gambitModifierTotal([], { mood: 70 }), 1);
  // The boundary belongs to Ecstatic, exactly as −64 belongs to Afraid.
  assert.equal(gambitModifierTotal([], { mood: 64 }), 1);
  assert.equal(gambitModifierTotal([], { mood: 63.99 }), 0);
});

test("the band is NAMED, so the confirm DM can say why", () => {
  assert.deepEqual(gambitModifiers([], { mood: -70 }), [{ label: "Afraid", value: -1 }]);
  assert.deepEqual(gambitModifiers([], { mood: -90 }), [{ label: "Panicking", value: -2 }]);
  assert.deepEqual(gambitModifiers([], { mood: 70 }), [{ label: "Ecstatic", value: 1 }]);
  assert.deepEqual(gambitModifiers([], { mood: 50 }), []);
});

test("Hungry costs -1, Starving costs -3, flat — no streak to scale it any more", () => {
  assert.equal(gambitModifierTotal(hungry, { mood: 0 }), -1);
  assert.equal(gambitModifierTotal(starving, { mood: 0 }), -3);
  assert.equal(gambitModifierTotal([], { mood: 0 }), 0);
});

test("Starving wins outright and never sums with Hungry", () => {
  // Holding both tags at once (the real shape a Starving sheet carries)
  // still costs exactly -3, never -4.
  assert.equal(gambitModifierTotal(starvingAndHungry, { mood: 0 }), -3);
  assert.deepEqual(gambitModifiers(starvingAndHungry, { mood: 0 }), [{ label: "Starving", value: -3 }]);
});

test("a good mood and a bad gut cancel, which nothing could do before", () => {
  // Hungry against Ecstatic: a wash, not a penalty.
  assert.equal(gambitModifierTotal(hungry, { mood: 70 }), 0);
  // Starving still outruns it.
  assert.equal(gambitModifierTotal(starving, { mood: 70 }), -2);
  // Both contributions are still NAMED, even when they sum to nothing.
  assert.deepEqual(gambitModifiers(hungry, { mood: 70 }), [
    { label: "Hungry", value: -1 },
    { label: "Ecstatic", value: 1 },
  ]);
});

test("a bare Tag[] works as well as the CharacterTag[] shape", () => {
  assert.equal(gambitModifierTotal([{ slug: "starving" }], { mood: 0 }), -3);
});

test("no mood argument means Fine, which is the silent failure worth naming", () => {
  // Documented, not endorsed: every call site must pass and select `mood`.
  assert.equal(gambitModifierTotal([], {}), 0);
  assert.equal(gambitModifierTotal([]), 0);
});

test("the breakdown formats with a real minus sign, as the bot rolls it", () => {
  assert.equal(formatGambitModifiers(gambitModifiers(starving, { mood: -90 })), "−3 Starving −2 Panicking");
});

test("a gain formats with a plain ASCII plus, not the U+2212 minus's twin", () => {
  assert.equal(formatGambitModifiers(gambitModifiers([], { mood: 70 })), "+1 Ecstatic");
  assert.equal(formatGambitModifiers(gambitModifiers(hungry, { mood: 70 })), "−1 Hungry +1 Ecstatic");
});
