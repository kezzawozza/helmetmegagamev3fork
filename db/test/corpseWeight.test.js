// node --test over db/lib/corpseWeight.js — what a body weighs.
const test = require("node:test");
const assert = require("node:assert/strict");
const { corpseBodyWeight, gearWeight, BASE_CORPSE_LBS, MIN_BODY_LBS } = require("../lib/corpseWeight");

const held = (...slugs) => slugs.map((slug) => ({ tag: { slug } }));

test("an ordinary body is the base weight", () => {
  assert.equal(corpseBodyWeight([]), BASE_CORPSE_LBS);
  assert.equal(corpseBodyWeight(held("literate", "brave")), BASE_CORPSE_LBS);
});

test("a plain body fits under the default carry cap", () => {
  assert.ok(corpseBodyWeight([]) < 71);
});

test("build changes what there is to carry", () => {
  assert.equal(corpseBodyWeight(held("giant")), 75);
  assert.equal(corpseBodyWeight(held("fat")), 65);
  assert.equal(corpseBodyWeight(held("frail")), 40);
  assert.equal(corpseBodyWeight(held("dwarf")), 35);
});

test("build multipliers compose rather than fighting", () => {
  assert.equal(corpseBodyWeight(held("frail", "dwarf")), 28);
  assert.ok(corpseBodyWeight(held("giant", "fat")) > corpseBodyWeight(held("giant")));
});

test("no combination makes a body weightless", () => {
  assert.ok(corpseBodyWeight(held("frail", "dwarf")) >= MIN_BODY_LBS);
});

test("Strong is deliberately not a weight modifier", () => {
  assert.equal(corpseBodyWeight(held("strong")), BASE_CORPSE_LBS);
});

test("the slug list form is accepted as well as CharacterTag rows", () => {
  assert.equal(corpseBodyWeight(["giant"]), corpseBodyWeight(held("giant")));
});

// --------------------------------------------------------------- their gear

const item = (slug, weightLbs, extra = {}) => ({
  quantity: 1,
  tag: { slug, weightLbs, tradeable: true, category: "Items", ...extra },
});

test("what is still on the sheet travels with the body", () => {
  assert.equal(gearWeight([item("plate-armor", 55), item("sword", 5)]), 60);
});

test("a quantity counts once per unit", () => {
  assert.equal(gearWeight([{ ...item("obol", 2), quantity: 4 }]), 8);
});

test("untradeable rows and Assets never weigh on the pallbearer", () => {
  assert.equal(gearWeight([item("neck-graft", 10, { tradeable: false })]), 0);
  assert.equal(gearWeight([item("arelitz", 900, { category: "Assets" })]), 0);
});

test("a corpse never counts toward its own weight", () => {
  assert.equal(gearWeight([item("custom-ada-corpse", 50, { corpseOfCharacterId: "c1" })]), 0);
  assert.equal(gearWeight([item("nekker-corpse", 35, { group: { slug: "items-corpse" } })]), 0);
});
