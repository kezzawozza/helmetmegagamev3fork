// armorWord's word bands and combineArmor's multiplicative stacking. Written
// after a real bug: a single Breastplate (ballisticArmor 0.2, exactly a band
// edge) combined through one equipped piece came back as
// 0.19999999999999996 in IEEE 754, which armorWord's strict `<` read as
// "Meager" instead of "Sufficient".
const test = require("node:test");
const assert = require("node:assert/strict");
const { armorPieces, armorWord, combineArmor, ARMOR_CAP } = require("../lib/armorValue");

const piece = (ballisticArmor) => ({ equipped: true, tag: { ballisticArmor } });

// --- armorWord -----------------------------------------------------------

test("armorWord: absent, zero, and negative all read None", () => {
  assert.equal(armorWord(undefined), "None");
  assert.equal(armorWord(0), "None");
  assert.equal(armorWord(-0.1), "None");
  assert.equal(armorWord(NaN), "None");
});

test("armorWord: the band edges, spelled out — 0.2/0.4/0.6/0.8", () => {
  assert.equal(armorWord(0.1), "Meager");
  assert.equal(armorWord(0.2), "Sufficient");
  assert.equal(armorWord(0.3), "Sufficient");
  assert.equal(armorWord(0.4), "Good");
  assert.equal(armorWord(0.6), "Strong");
  assert.equal(armorWord(0.8), "Overkill");
  assert.equal(armorWord(1), "Overkill");
});

// --- combineArmor ----------------------------------------------------------

test("combineArmor: nothing equipped is None", () => {
  assert.equal(combineArmor([], "ballisticArmor"), 0);
});

test("combineArmor: a single piece exactly at a band edge lands ON the edge, not just under it", () => {
  const value = combineArmor([piece(0.2)], "ballisticArmor");
  assert.equal(value, 0.2);
  assert.equal(armorWord(value), "Sufficient");
});

test("combineArmor: an unequipped piece contributes nothing", () => {
  const value = combineArmor([{ equipped: false, tag: { ballisticArmor: 0.5 } }], "ballisticArmor");
  assert.equal(value, 0);
});

test("combineArmor: a bare Tag[] with no `equipped` field still counts — only `=== false` excludes", () => {
  const value = combineArmor([{ ballisticArmor: 0.2 }], "ballisticArmor");
  assert.equal(value, 0.2);
});

test("combineArmor: two pieces stack multiplicatively on what gets through", () => {
  const value = combineArmor([piece(0.4), piece(0.25)], "ballisticArmor"); // TAGS.md's worked example
  assert.equal(value, 0.55);
});

test("combineArmor: never exceeds the cap, however much is stacked", () => {
  const stack = Array.from({ length: 6 }, () => piece(0.9));
  const value = combineArmor(stack, "ballisticArmor");
  assert.equal(value, ARMOR_CAP);
});

test("combineArmor: reads meleeArmor or ballisticArmor by field, never both at once", () => {
  const entry = { equipped: true, tag: { meleeArmor: 0.6, ballisticArmor: 0.2 } };
  assert.equal(combineArmor([entry], "meleeArmor"), 0.6);
  assert.equal(combineArmor([entry], "ballisticArmor"), 0.2);
});

// --- armorPieces ---------------------------------------------------------
// combineArmor says how much gets through; this says WHAT is stopping it, for
// the GM surfaces (COMBAT.md §6). The two must never disagree about which
// pieces are in play, which is what the equipped tests below are really for.

const named = (name, meleeArmor, equipped = true) => ({ equipped, tag: { name, meleeArmor } });

test("armorPieces: names worn pieces, heaviest first, with the word each earns alone", () => {
  const rows = [named("Leather Cap", 0.15), named("Mail Hauberk", 0.5)];
  assert.deepEqual(
    armorPieces(rows, "meleeArmor").map((p) => [p.label, p.word]),
    [
      ["Mail Hauberk", "Good"],
      ["Leather Cap", "Meager"],
    ],
  );
});

test("armorPieces: a stowed piece is not worn, and combineArmor agrees", () => {
  const rows = [named("Mail Hauberk", 0.5), named("Stowed Breastplate", 0.6, false)];
  assert.equal(armorPieces(rows, "meleeArmor").length, 1);
  assert.equal(armorWord(combineArmor(rows, "meleeArmor")), "Good");
});

test("armorPieces: a bare Tag[] with no equipped flag still resolves", () => {
  assert.equal(armorPieces([{ name: "Mail", meleeArmor: 0.5 }], "meleeArmor").length, 1);
});

test("armorPieces: nothing worn, and a piece worth nothing, are both an empty list", () => {
  assert.deepEqual(armorPieces([], "meleeArmor"), []);
  assert.deepEqual(armorPieces([named("Shirt", 0)], "meleeArmor"), []);
});

test("armorPieces: falls back to the slug, then to a placeholder, for a nameless tag", () => {
  assert.equal(armorPieces([{ slug: "odd-plate", meleeArmor: 0.3 }], "meleeArmor")[0].label, "odd-plate");
  assert.equal(armorPieces([{ meleeArmor: 0.3 }], "meleeArmor")[0].label, "Something");
});
