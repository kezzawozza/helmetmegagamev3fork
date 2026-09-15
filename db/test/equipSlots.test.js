// db/lib/equipSlots.js: what cannot be worn together. Locks down the collapsed
// slot model — HEAD is one thing, BODY is Mail under Over — since the rule is
// enforced after the write and a mistake here reads to a player as an
// unrelated equip being refused.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LAYER_NAMES,
  LAYERED_SLOTS,
  findSlotClash,
  findEquipProblem,
  describeEquipFit,
} = require("../lib/equipSlots");

const head = (name) => ({ tag: { name, equipSlot: "HEAD", equipLayer: null } });
const body = (name, equipLayer) => ({ tag: { name, equipSlot: "BODY", equipLayer } });

test("a head holds exactly one thing", () => {
  assert.equal(findSlotClash([head("Mail Coif")]), null);
  const clash = findSlotClash([head("Mail Coif"), head("Hood")]);
  assert.ok(clash, "a coif and a hood no longer stack");
  assert.match(findEquipProblem([head("Mail Coif"), head("Hood")]), /can't both go on your head/);
});

test("HEAD is not a layered slot, so nothing can claim a layer in it", () => {
  assert.equal(LAYERED_SLOTS.has("HEAD"), false);
  assert.equal(LAYER_NAMES.HEAD, undefined);
});

test("armour goes over clothes, but two of either do not", () => {
  // Mail (1) under Over (2) is the whole point of keeping two body layers.
  assert.equal(findSlotClash([body("Black Robes", 1), body("Breastplate", 2)]), null);
  assert.ok(findSlotClash([body("Black Robes", 1), body("Vestments", 1)]));
  assert.ok(findSlotClash([body("Breastplate", 2), body("Plate Armor", 2)]));
});

test("the body has two layers and they are named for what a player is doing", () => {
  assert.deepEqual(LAYER_NAMES.BODY, ["Mail", "Over"]);
});

test("a stack equipped twice clashes with itself — two hats are two hats", () => {
  const hats = [{ equippedQuantity: 2, tag: { name: "Hat", equipSlot: "HEAD", equipLayer: null } }];
  assert.match(findEquipProblem(hats), /only have one Hat on your head/);
});

test("a shopper is told where a thing sits by name, not by layer number", () => {
  assert.equal(describeEquipFit({ equipSlot: "BODY", equipLayer: 2 }), "Body · Over");
  assert.equal(describeEquipFit({ equipSlot: "HEAD", equipLayer: null }), "Head");
});
