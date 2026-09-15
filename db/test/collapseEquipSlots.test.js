// db/scripts/ops/collapse-equip-slots.js: which piece survives when the
// HEAD/BODY collapse leaves somebody wearing more than fits.
//
// Worth pinning down because the script is SILENT — no DM goes to the player
// whose helm comes off — so a wrong pick here is a character quietly walking
// into a fight lighter, or unmasked, with nothing saying so.
const test = require("node:test");
const assert = require("node:assert/strict");
const { losers } = require("../scripts/ops/collapse-equip-slots");

const head = (id, name, extra = {}) => ({
  id,
  equippedQuantity: 1,
  tag: { name, equipSlot: "HEAD", equipLayer: null, meleeArmor: 0, ballisticArmor: 0, concealsIdentity: false, ...extra },
});

const names = (rows) => rows.map((r) => r.tag.name).sort();

test("the best armour stays on", () => {
  const rows = [
    head("a", "Hood"),
    head("b", "Knight's Helmet", { meleeArmor: 0.5, ballisticArmor: 0.4 }),
    head("c", "Padded Cap", { meleeArmor: 0.1 }),
  ];
  assert.deepEqual(names(losers(rows).unequip), ["Hood", "Padded Cap"]);
});

test("with nothing to choose on armour, the piece hiding a face stays on", () => {
  const rows = [head("a", "Hat"), head("b", "Plague Doctor Mask", { concealsIdentity: true })];
  assert.deepEqual(names(losers(rows).unequip), ["Hat"]);
});

test("armour beats concealment — you can be recognised, you cannot be unstabbed", () => {
  const rows = [
    head("a", "Bone Mask", { concealsIdentity: true }),
    head("b", "Great Helm", { meleeArmor: 0.6 }),
  ];
  assert.deepEqual(names(losers(rows).unequip), ["Bone Mask"]);
});

test("two runs agree, whichever order the rows arrive in", () => {
  const rows = [head("a", "Hat"), head("b", "Bag")];
  assert.deepEqual(names(losers(rows).unequip), names(losers([...rows].reverse()).unequip));
});

test("a body keeps one piece per layer, not one piece", () => {
  const body = (id, name, equipLayer, meleeArmor = 0) => ({
    id, equippedQuantity: 1,
    tag: { name, equipSlot: "BODY", equipLayer, meleeArmor, ballisticArmor: 0, concealsIdentity: false },
  });
  // Mail under Over is legal, so nothing comes off.
  assert.deepEqual(losers([body("a", "Black Robes", 1), body("b", "Breastplate", 2)]).unequip, []);
  // Two at the same layer is not.
  assert.deepEqual(
    names(losers([body("a", "Black Robes", 1), body("b", "Mail Shirt", 1, 0.4)]).unequip),
    ["Black Robes"],
  );
});

test("hands and accessories are left alone — they have their own limits", () => {
  const weapon = (id, name) => ({ id, equippedQuantity: 1, tag: { name, equipSlot: "WEAPON", equipLayer: null } });
  const trinket = (id, name) => ({ id, equippedQuantity: 1, tag: { name, equipSlot: "ACCESSORY", equipLayer: null } });
  const { unequip } = losers([weapon("a", "Sword"), weapon("b", "Axe"), trinket("c", "Badge"), trinket("d", "Pin")]);
  assert.deepEqual(unequip, []);
});

test("a stack worn more than once is cut back to one, not taken off", () => {
  const rows = [{ id: "a", equippedQuantity: 3, tag: { name: "Hat", equipSlot: "HEAD", equipLayer: null, meleeArmor: 0, ballisticArmor: 0, concealsIdentity: false } }];
  const { unequip, trims } = losers(rows);
  assert.deepEqual(unequip, []);
  assert.equal(trims.length, 1);
  assert.equal(trims[0].to, 1);
});
