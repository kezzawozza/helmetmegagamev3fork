// Prospecting (LABORING.md §2), the fourth side-grade alongside
// Hunting/Farming/Fishing. Nothing here touches Prisma; resolveLaborRateFrom
// takes a plain ctx object.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PRODUCTION_RATES, SPECIALISATION_KINDS, computeRate } = require("../lib/production");
const { resolveLaborRateFrom, laborTierLabel } = require("../lib/laborAccess");
const { normalizeLaborBonus, validateLaborBonus } = require("../lib/tagShapes");

test("production: prospecting's range is 2-8 at coefficient 1.0, and it maps to LaborKind.PROSPECTING", () => {
  assert.deepEqual(PRODUCTION_RATES.labor.prospecting, { min: 2, max: 8 });
  assert.equal(SPECIALISATION_KINDS.prospecting, "PROSPECTING");
  assert.deepEqual(computeRate("labor", "prospecting", 1, 1), { min: 2, max: 8 });
});

test("production: prospecting scales by the dial and the location coefficient like every other specialisation", () => {
  assert.deepEqual(computeRate("labor", "prospecting", 0.5, 2), { min: 2, max: 8 });
});

test("laborAccess: prospecting wins when it has the better ceiling", () => {
  const ctx = {
    yields: { PROSPECTING: 1.4, HUNTING: 0.6 },
    refinery: false,
    tagSlugs: new Set(["laboring-skilled", "laboring-prospecting", "laboring-hunting"]),
    tools: [],
  };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, true);
  assert.equal(result.tier, "prospecting");
  assert.deepEqual([result.min, result.max], [2 * 1.4, 8 * 1.4].map(Math.round));
  assert.equal(laborTierLabel(result.tier), "Prospecting");
});

test("laborAccess: holding Prospecting does nothing where the Location has no PROSPECTING row", () => {
  const ctx = {
    yields: { HUNTING: 0.8 },
    refinery: false,
    tagSlugs: new Set(["laboring-skilled", "laboring-prospecting", "laboring-hunting"]),
    tools: [],
  };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, true);
  assert.equal(result.tier, "hunting");
});

test("laborAccess: Prospecting alone with no matching row falls back to the general tier", () => {
  const ctx = {
    yields: {},
    refinery: false,
    tagSlugs: new Set(["laboring-basic", "laboring-skilled", "laboring-prospecting"]),
    tools: [],
  };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, true);
  assert.equal(result.tier, "skilled");
});

test("tagShapes: laborBonus.kind accepts prospecting, same as the other three", () => {
  const normalized = normalizeLaborBonus({ kind: "prospecting", amount: 1 });
  assert.deepEqual(normalized, { kind: "prospecting", amount: 1, equipped: true, requiresTag: null });
  assert.doesNotThrow(() =>
    validateLaborBonus(normalized, { selfSlug: "pickaxe", tagSlugs: new Set(), equippable: true }),
  );
});
