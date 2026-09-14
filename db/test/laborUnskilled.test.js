// Laboring is not a gate: no Laboring tag still labors, just for nothing —
// including on the Godard Factory floor, which prices a refining shift's
// skill ladder in ⬢ it never pays (LABORING.md §1, §3b). Nothing here
// touches Prisma; resolveLaborRateFrom takes a plain ctx.
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveLaborRateFrom } = require("../lib/laborAccess");

const UNPAID = "0-0"; // real "0-0", not empty — a failed parse also pays nothing, silently

test("laborAccess: no Laboring tag at all still labors, for nothing", () => {
  const ctx = { yields: { HUNTING: 0.8 }, refinery: false, tagSlugs: new Set(), tools: [] };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, true);
  assert.equal(result.tier, "unskilled");
  assert.deepEqual([result.min, result.max], [0, 0]);
  assert.equal(result.expression, UNPAID);
});

test("laborAccess: a skill that doesn't reach this ground labors for nothing too", () => {
  const ctx = {
    yields: {},
    refinery: false,
    tagSlugs: new Set(["laboring-hunting"]),
    tools: [],
  };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, true);
  assert.equal(result.tier, "unskilled");
});

test("laborAccess: the Factory floor is worked with no Laboring tag — the whole point of the fix", () => {
  const ctx = {
    yields: {},
    refinery: true,
    refineryInput: { id: "godflesh-row" },
    tagSlugs: new Set(),
    tools: [],
  };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, true);
  assert.equal(result.tier, "refining");
  assert.equal(result.refinery, true);
});

test("laborAccess: an empty Factory floor still refuses, tag or no tag", () => {
  const ctx = { yields: {}, refinery: true, refineryInput: null, tagSlugs: new Set(), tools: [] };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, false);
  assert.match(result.reason, /Godflesh/);
});

test("laborAccess: Exhausted still refuses somebody with no Laboring tag", () => {
  const ctx = { yields: { HUNTING: 0.8 }, refinery: false, tagSlugs: new Set(["exhausted"]), tools: [] };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, false);
  assert.match(result.reason, /Exhausted/);
});

test("laborAccess: an incapacitated character with no Laboring tag still can't work", () => {
  const ctx = { yields: {}, refinery: true, refineryInput: { id: "x" }, tagSlugs: new Set(["bound"]), tools: [] };
  const result = resolveLaborRateFrom(ctx, 1, {});
  assert.equal(result.ok, false);
});

test("laborAccess: an unskilled day draws no labor drop", () => {
  const { TIER_TO_LABOR_DROP_TYPE } = require("../lib/laborDrops");
  assert.equal(TIER_TO_LABOR_DROP_TYPE.unskilled, undefined);
  assert.equal(TIER_TO_LABOR_DROP_TYPE.basic, "BASIC");
});
