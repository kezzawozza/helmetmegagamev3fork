// db/lib/labordropsEv.js — priceEntry/summarize, extracted verbatim out of
// db/scripts/ops/audit-labor-drops.js. This pins the shape the script relies
// on (summarize's return, priceEntry's branch order) so the extraction can
// be checked without running the CLI against a database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { priceEntry, summarize, OBOL_SLUG, OBOL_VALUE } = require("../lib/labordropsEv");

test("priceEntry: NOTHING and RESOURCES need no tag lookup", () => {
  assert.deepEqual(priceEntry({ kind: "NOTHING" }, new Map()), { label: "(nothing)", evValue: 0, note: null });
  assert.deepEqual(priceEntry({ kind: "RESOURCES", resourceAmount: 5 }, new Map()), {
    label: "+5 ⬢",
    evValue: 5,
    note: null,
  });
  assert.deepEqual(priceEntry({ kind: "RESOURCES", resourceAmount: -2 }, new Map()), {
    label: "-2 ⬢",
    evValue: -2,
    note: null,
  });
});

test("priceEntry: the obol itself prices at OBOL_VALUE, ahead of any tag pricing", () => {
  const tagsById = new Map([["t1", { slug: OBOL_SLUG, name: "Obol", sellable: true, sellablePrice: 999 }]]);
  const result = priceEntry({ kind: "TAG", tagId: "t1" }, tagsById);
  assert.equal(result.evValue, OBOL_VALUE);
});

test("priceEntry: a sellable tag with no override prices at its sellablePrice", () => {
  const tagsById = new Map([["t1", { slug: "bread", name: "Bread", sellable: true, sellablePrice: 4 }]]);
  const result = priceEntry({ kind: "TAG", tagId: "t1" }, tagsById);
  assert.equal(result.evValue, 4);
  assert.equal(result.note, null);
});

test("priceEntry: a non-sellable tag with consumesIntoResources prices at that", () => {
  const tagsById = new Map([["t1", { slug: "purse", name: "Purse", consumesIntoResources: 12 }]]);
  const result = priceEntry({ kind: "TAG", tagId: "t1" }, tagsById);
  assert.equal(result.evValue, 12);
});

test("priceEntry: an unpriced tag reports 0 ⬢ and is flagged 'unpriced'", () => {
  const tagsById = new Map([["t1", { slug: "trinket", name: "Trinket", pointCost: 3 }]]);
  const result = priceEntry({ kind: "TAG", tagId: "t1" }, tagsById);
  assert.equal(result.evValue, 0);
  assert.equal(result.note, "unpriced");
});

// summarize(rows, tagsById, roll) returns { priced, hits, hit, ev, unpriced, shares }
// — the exact shape audit-labor-drops.js destructures at both its call sites.
test("summarize: returns the shape the script relies on", () => {
  const rows = [{ kind: "RESOURCES", resourceAmount: 5 }, { kind: "NOTHING" }];
  const result = summarize(rows, new Map(), 1);
  assert.ok(Array.isArray(result.priced));
  assert.equal(result.priced.length, 2);
  assert.equal(typeof result.hits, "number");
  assert.equal(typeof result.hit, "number");
  assert.equal(typeof result.ev, "number");
  assert.equal(typeof result.unpriced, "number");
  assert.ok(Array.isArray(result.shares));

  // Cross-check against the die's own roll-1 column (db/lib/labordropsRarity.js):
  // nothing 0.45, resources 0.065, and since no rarity tier is authored the
  // leftover column mass falls to `resources` (the only live band). ev is the
  // resources row's own delta times its (boosted) share; hit is that same
  // share, since NOTHING never counts as a hit.
  const expectedResourcesShare = 1 - 0.45;
  assert.ok(Math.abs(result.ev - 5 * expectedResourcesShare) < 1e-9);
  assert.ok(Math.abs(result.hit - expectedResourcesShare) < 1e-9);
  assert.equal(result.hits, 1);
  assert.equal(result.unpriced, 0);
});

test("summarize: an unpriced tag is counted in `unpriced`", () => {
  const tagsById = new Map([["t1", { slug: "trinket", name: "Trinket", pointCost: 3, rarity: "common" }]]);
  const rows = [{ kind: "TAG", tagId: "t1", rarity: "common" }];
  const result = summarize(rows, tagsById, 1);
  assert.equal(result.unpriced, 1);
  assert.equal(result.ev, 0);
});
