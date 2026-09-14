// armorWord's word bands and combineArmor's multiplicative stacking. Written
// after a real bug: a single Breastplate (ballisticArmor 0.2, exactly a band
// edge) combined through one equipped piece came back as
// 0.19999999999999996 in IEEE 754, which armorWord's strict `<` read as
// "Meager" instead of "Sufficient".
const test = require("node:test");
const assert = require("node:assert/strict");
const { armorWord, combineArmor, ARMOR_CAP } = require("../lib/armorValue");

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
