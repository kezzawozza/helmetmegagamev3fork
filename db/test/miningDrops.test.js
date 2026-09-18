// node --test over db/lib/miningDrops.js's scopeFilters — the three-bucket
// combine rule MININGDROPS.md §2 promises — and passesRequiredTag, the
// gate beside them (MININGDROPS.md §2a). Nothing here touches Prisma;
// pickMiningDropOption itself is exercised against a real local database
// instead (see MININGDROPS.md's smoke-test note), the same split
// db/lib/cavingLoot.js's validateCavingLoot/LOOT_TABLE draws.
const test = require("node:test");
const assert = require("node:assert/strict");
const { scopeFilters, passesRequiredTag } = require("../lib/miningDrops");

function sorted(filters) {
  return filters
    .map((f) => JSON.stringify([f.zoneId, f.locationId]))
    .sort();
}

test("global only: just the all-null bucket", () => {
  assert.deepEqual(scopeFilters(null, null), [{ zoneId: null, locationId: null }]);
});

test("a zone: global and the zone, and nothing else", () => {
  const filters = scopeFilters("zone1", null);
  assert.equal(filters.length, 2);
  assert.deepEqual(
    sorted(filters),
    sorted([
      { zoneId: null, locationId: null }, // Global
      { zoneId: "zone1", locationId: null }, // Zone
    ]),
  );
});

test("zone and location together: all three buckets, and never both on one", () => {
  const filters = scopeFilters("zone1", "loc1");
  // A real Action always carries both, so all three buckets fire at once —
  // zoneId and locationId are never combined on the SAME bucket, but Zone and
  // Location buckets both apply independently against the same roll.
  assert.equal(filters.length, 3);
  for (const f of filters) {
    assert.ok(!(f.zoneId && f.locationId), "no bucket ever sets both zoneId and locationId");
  }
  assert.deepEqual(
    sorted(filters),
    sorted([
      { zoneId: null, locationId: null },
      { zoneId: "zone1", locationId: null },
      { zoneId: null, locationId: "loc1" },
    ]),
  );
});

test("passesRequiredTag: an ungated row always passes, regardless of what's held", () => {
  assert.equal(passesRequiredTag({ requiredTagId: null }), true);
  assert.equal(passesRequiredTag({ requiredTagId: null }, new Set()), true);
  assert.equal(passesRequiredTag({ requiredTagId: null }, new Set(["forester-id"])), true);
});

test("passesRequiredTag: a gated row needs the exact tag, and defaults closed", () => {
  const row = { requiredTagId: "forester-id" };
  // No heldTagIds argument at all — the default must exclude, not leak in.
  assert.equal(passesRequiredTag(row), false);
  assert.equal(passesRequiredTag(row, new Set()), false);
  assert.equal(passesRequiredTag(row, new Set(["butcher-id"])), false);
  assert.equal(passesRequiredTag(row, new Set(["forester-id"])), true);
  assert.equal(passesRequiredTag(row, new Set(["butcher-id", "forester-id"])), true);
});
