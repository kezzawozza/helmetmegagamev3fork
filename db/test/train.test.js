// node --test over the cargo train's clock and the Depot's shelves — the two
// pure pieces of the counter rework. Run with `npm test --workspace=db`.
//
// Nothing here touches Prisma. The point is the property that makes the train
// safe to resume a half-finished turn advance against: PARITY DECIDES WHICH
// HALF RUNS, AND NOTHING ELSE. What actually moves is decided by rows
// (`deliveredAt: null`, `settledAt: null`) inside the passes, so a doubled or
// skipped advance costs a turn of flavour and never a shipment — which is the
// thing that would otherwise be very expensive to find out in a live game.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isArrivalTurn, isDepartureTurn, trainState } = require("../lib/train");
const { stampFor } = require("../lib/trainArrivalPass");
const { crateTagData, splitIntoCrates } = require("../lib/depotCrates");
const {
  MANIFESTS,
  MANIFEST_IDS,
  MANIFEST_GENERAL,
  MANIFEST_MERCHANT,
  MANIFEST_BLACK_MARKET,
  manifestOf,
  manifestsFor,
  canOrder,
  isManifestId,
} = require("../lib/depotManifests");

test("turn 1 is a departure and the train is nowhere — turn 2 brings down what was ordered on turn 1", () => {
  assert.equal(isDepartureTurn(1), true);
  assert.equal(isArrivalTurn(1), false);
  assert.equal(isArrivalTurn(2), true);
  assert.equal(trainState(1).here, false);
  assert.equal(trainState(2).here, true);
});

test("exactly one half of the cycle runs on any turn, for a long stretch of them", () => {
  for (let n = 0; n <= 60; n += 1) {
    assert.equal(
      isArrivalTurn(n) !== isDepartureTurn(n),
      true,
      `turn ${n} ran both halves or neither`,
    );
  }
});

test("a turn number that is missing reads as the resting state rather than throwing", () => {
  // resolveNeeds and the Railyard's starter post both reach this with whatever
  // the open turn happened to be, which on a fresh database is nothing.
  assert.equal(isArrivalTurn(undefined), true);
  assert.equal(isArrivalTurn(null), true);
  assert.equal(typeof trainState(null).label, "string");
});

test("every manifest in the catalog has an id, a name and something to say", () => {
  assert.equal(MANIFESTS.length, MANIFEST_IDS.length);
  for (const m of MANIFESTS) {
    assert.equal(typeof m.id, "string");
    assert.ok(m.name.length > 0, `${m.id} has no name`);
    assert.ok(m.blurb.length > 0, `${m.id} has no blurb`);
    assert.equal(isManifestId(m.id), true);
  }
});

test("a ware naming no manifest is the Merchant's, which is the strictest default", () => {
  assert.equal(manifestOf({}), MANIFEST_MERCHANT);
  assert.equal(manifestOf({ manifest: null }), MANIFEST_MERCHANT);
  // A typo must not quietly open a shelf it was never meant to. syncTags.js
  // refuses one outright; this is the runtime half of the same rule.
  assert.equal(manifestOf({ manifest: "not-a-shelf" }), MANIFEST_MERCHANT);
});

test("a chip opens the black market and nothing else; a licence opens everything", () => {
  const nobody = manifestsFor(new Set()).map((m) => m.id);
  assert.deepEqual(nobody, [MANIFEST_GENERAL]);

  const chip = manifestsFor(new Set(["silver-chip"])).map((m) => m.id);
  assert.deepEqual(chip, [MANIFEST_GENERAL, MANIFEST_BLACK_MARKET]);

  const merchant = manifestsFor(new Set(["merchants-license"])).map((m) => m.id);
  assert.deepEqual(merchant, [MANIFEST_GENERAL, MANIFEST_MERCHANT]);

  // A Depot Keycard is not a shelf. It opens the Railyard and cracks a sealed
  // crate; it has never decided what anybody may order.
  const docker = manifestsFor(new Set(["depot-keycard"])).map((m) => m.id);
  assert.deepEqual(docker, [MANIFEST_GENERAL]);
});

test("canOrder is the per-ware gate the order action re-checks, and it agrees with manifestsFor", () => {
  const bulk = { manifest: MANIFEST_GENERAL };
  const booze = { manifest: MANIFEST_BLACK_MARKET };
  const pistol = { manifest: null };

  assert.equal(canOrder(bulk, new Set()), true);
  assert.equal(canOrder(booze, new Set()), false);
  assert.equal(canOrder(pistol, new Set()), false);

  assert.equal(canOrder(booze, new Set(["silver-chip"])), true);
  assert.equal(canOrder(pistol, new Set(["silver-chip"])), false);
  assert.equal(canOrder(pistol, new Set(["merchants-license"])), true);
});

test("a crate says whose it is, between the shipment id and the contents", () => {
  const order = { holderName: "Ada Voss", fingerprint: "AV-2017", anonymous: false };
  const crates = splitIntoCrates([{ tagId: "t1", name: "Coal", quantity: 4, sealed: false }]);
  const [data] = crateTagData("RV-4471-K", crates, { weightByTagId: new Map([["t1", 7]]) });
  const stamped = data.description.replace("]:", `] · ${stampFor(order)}:`);
  assert.equal(stamped, "[SHIPMENT ID RV-4471-K] · Ada Voss · AV-2017: Coal x 4");
});

test("a sealed crate still says whose it is — the seal hides WHAT, not WHOSE", () => {
  const order = { holderName: "Ada Voss", fingerprint: "AV-2017", anonymous: false };
  const crates = splitIntoCrates([{ tagId: "t1", name: "ML-23", quantity: 1, sealed: true }]);
  const [data] = crateTagData("RV-4471-K", crates, { weightByTagId: new Map([["t1", 2]]) });
  const stamped = data.description.replace("]:", `] · ${stampFor(order)}:`);
  assert.equal(stamped, "[SHIPMENT ID RV-4471-K] · Ada Voss · AV-2017: SEALED");
  assert.equal(data.sealedShipping, true);
});

test("paying to keep your name off it replaces the stamp, and only this row remembers", () => {
  const order = { holderName: "Ada Voss", fingerprint: "AV-2017", anonymous: true };
  assert.equal(stampFor(order), "ANONYMOUS");
  assert.equal(stampFor(order).includes("Ada"), false);
  assert.equal(stampFor(order).includes("AV-2017"), false);
});
