// node --test over mountsToTakeUp (db/lib/indoors.js), the pure rule behind
// Character.autoMount. Locks in the selection order (fastest stowed ridden
// mount, plus the Cart), and every clash it has to defer to — a slot already
// in use, Motion Sickness, the ACT blocker — the same ones equipOne names.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mountsToTakeUp } = require("../lib/indoors");
const { FAST_TRAVEL_SLUGS } = require("../lib/mounts");

function row(slug, { equipped = false, quantity = 1 } = {}) {
  const equipSlot = ["horse", "motorcycle", "arelitz-warbeast", "arelitz-thoroughbred", "arelitz-ovum", "fishing-boat", "cart"].includes(
    slug,
  )
    ? "MOUNT"
    : null;
  return {
    id: slug,
    quantity,
    equippedQuantity: equipped ? 1 : 0,
    tag: { slug, name: slug, equipSlot },
  };
}

test("horse + cart stowed: takes up both", () => {
  const rows = mountsToTakeUp([row("horse"), row("cart")]);
  assert.deepEqual(rows.map((r) => r.tag.slug), ["horse", "cart"]);
});

test("thoroughbred + horse + cart stowed: thoroughbred wins, plus cart", () => {
  const rows = mountsToTakeUp([row("arelitz-thoroughbred"), row("horse"), row("cart")]);
  assert.deepEqual(rows.map((r) => r.tag.slug), ["arelitz-thoroughbred", "cart"]);
});

test("horse stowed, fishing-boat equipped: slot already spent, nothing happens", () => {
  const rows = mountsToTakeUp([row("horse"), row("fishing-boat", { equipped: true })]);
  assert.deepEqual(rows, []);
});

test("horse stowed, arelitz-ovum equipped: slot already spent, nothing happens", () => {
  const rows = mountsToTakeUp([row("horse"), row("arelitz-ovum", { equipped: true })]);
  assert.deepEqual(rows, []);
});

test("horse equipped, cart stowed: slot already in use, leave it alone", () => {
  const rows = mountsToTakeUp([row("horse", { equipped: true }), row("cart")]);
  assert.deepEqual(rows, []);
});

test("horse + cart stowed + motion sickness held: cart only", () => {
  const rows = mountsToTakeUp([row("horse"), row("cart"), row("motion-sickness")]);
  assert.deepEqual(rows.map((r) => r.tag.slug), ["cart"]);
});

test("horse stowed + bound held: ACT blocker refuses everything", () => {
  const rows = mountsToTakeUp([row("horse"), row("bound")]);
  assert.deepEqual(rows, []);
});

test("horse with quantity 0: nothing to take up", () => {
  const rows = mountsToTakeUp([row("horse", { quantity: 0 })]);
  assert.deepEqual(rows, []);
});

test("no tags: nothing happens", () => {
  const rows = mountsToTakeUp([]);
  assert.deepEqual(rows, []);
});

test("every fast-travel mount is in the ride order: each one stowed alone is taken up", () => {
  for (const slug of FAST_TRAVEL_SLUGS) {
    const rows = mountsToTakeUp([row(slug)]);
    assert.deepEqual(rows.map((r) => r.tag.slug), [slug], slug);
  }
});
