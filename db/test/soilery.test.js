// node --test over db/lib/soilery.js. Pure and Prisma-free. Covers
// validatePlan's rejection paths, reap()'s real per-unit variance (never a
// rounded average), and a consistency check that CROPS[]'s hardcoded
// sowing/crop slugs actually exist in docs/tags.yaml with the bag/sowing
// pairing they assume — the same drift hazard xom.test.js guards against
// (TURN-ENGINE.md), just for the Soilery pairing instead.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  FARM_MAX_CROPS,
  WITHER_IN,
  CROPS,
  sowableCrops,
  validatePlan,
  reap,
  harvestLine,
} = require("../lib/soilery");

const licensedAll = CROPS.map((entry) => ({ ...entry }));
const licensedWheatOnly = [CROPS[0]];

test("sowableCrops: only the crops a character holds the sowing ticket for", () => {
  const tags = [{ tag: { slug: "sowing-wheat" } }, { tag: { slug: "sowing-onion" } }];
  const result = sowableCrops(tags);
  assert.deepEqual(
    result.map((r) => r.crop).sort(),
    ["onion", "wheat"],
  );
});

test("sowableCrops: nothing held, nothing licensed", () => {
  assert.deepEqual(sowableCrops([]), []);
  assert.deepEqual(sowableCrops(), []);
});

test("validatePlan: rejects an empty or missing plan", () => {
  assert.equal(validatePlan([], licensedAll).ok, false);
  assert.equal(validatePlan(null, licensedAll).ok, false);
  assert.equal(validatePlan(undefined, licensedAll).ok, false);
});

test("validatePlan: rejects a crop the character has no sowing ticket for", () => {
  const result = validatePlan([{ crop: "potato", planted: 5 }], licensedWheatOnly);
  assert.equal(result.ok, false);
  assert.match(result.error, /potato/);
});

test("validatePlan: rejects a non-integer or non-positive planted count", () => {
  assert.equal(validatePlan([{ crop: "wheat", planted: 0 }], licensedWheatOnly).ok, false);
  assert.equal(validatePlan([{ crop: "wheat", planted: -5 }], licensedWheatOnly).ok, false);
  assert.equal(validatePlan([{ crop: "wheat", planted: 2.5 }], licensedWheatOnly).ok, false);
  assert.equal(validatePlan([{ crop: "wheat", planted: "30" }], licensedWheatOnly).ok, false);
});

test("validatePlan: rejects a total over FARM_MAX_CROPS, even split across crops", () => {
  const result = validatePlan(
    [
      { crop: "wheat", planted: 30 },
      { crop: "potato", planted: 21 },
    ],
    licensedAll,
  );
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(String(FARM_MAX_CROPS)));
});

test("validatePlan: accepts exactly FARM_MAX_CROPS split across multiple crops", () => {
  const result = validatePlan(
    [
      { crop: "wheat", planted: 20 },
      { crop: "potato", planted: 20 },
      { crop: "onion", planted: 10 },
    ],
    licensedAll,
  );
  assert.equal(result.ok, true);
});

test("validatePlan: accepts a single crop under the cap", () => {
  assert.equal(validatePlan([{ crop: "wheat", planted: 1 }], licensedWheatOnly).ok, true);
});

test("reap: a rng that never rolls the wither slot never loses a plant", () => {
  assert.equal(reap(60, () => 0.99), 60);
});

test("reap: a rng that always rolls the wither slot loses everything", () => {
  // floor(0 * WITHER_IN) === 0 every time, which is the wither branch.
  assert.equal(reap(60, () => 0), 0);
});

test("reap: planting 0 reaps 0, with no rng calls needed", () => {
  assert.equal(reap(0), 0);
});

test("reap: real per-unit variance, not a rounded average — a large sample lands within 3 std dev of the true mean", () => {
  const planted = 6000;
  const reaped = reap(planted);
  const mean = planted * (WITHER_IN - 1) / WITHER_IN;
  const variance = planted * (1 / WITHER_IN) * (1 - 1 / WITHER_IN);
  const stdDev = Math.sqrt(variance);
  assert.ok(
    Math.abs(reaped - mean) <= 3 * stdDev,
    `reaped ${reaped} is more than 3 std dev (${stdDev.toFixed(1)}) from the expected mean ${mean}`,
  );
});

test("harvestLine: formats one clause per row, joined by commas", () => {
  const line = harvestLine([
    { planted: 30, cropName: "Wheat", reaped: 25 },
    { planted: 20, cropName: "Potato", reaped: 18 },
  ]);
  assert.equal(line, "sowed 30 Wheat and reaped 25, sowed 20 Potato and reaped 18");
});

test("harvestLine: empty/missing rows produce an empty string, not a throw", () => {
  assert.equal(harvestLine([]), "");
  assert.equal(harvestLine(undefined), "");
});

// --- Consistency check against the live tags.yaml, not a mock of it ---
test("CROPS[]: every sowing/crop slug pair actually exists in docs/tags.yaml, with the bag pointed at the right sowing ticket", () => {
  const tagsPath = path.join(__dirname, "..", "..", "docs", "tags.yaml");
  const doc = yaml.load(fs.readFileSync(tagsPath, "utf8"));
  const tags = doc.tags;
  assert.ok(tags, "docs/tags.yaml did not parse to the expected { tags: {...} } shape");

  for (const { sowing, crop } of CROPS) {
    assert.ok(tags[crop], `CROPS references crop tag "${crop}", which is not in docs/tags.yaml`);
    assert.ok(tags[sowing], `CROPS references sowing tag "${sowing}", which is not in docs/tags.yaml`);

    // Every crop that isn't a foodstuff (pigtails) is still a real Item tag;
    // every sowing ticket is a hidden status tag with a 1-turn clock.
    assert.equal(tags[sowing].durationTurns, 1, `sowing tag "${sowing}" should carry durationTurns: 1`);

    // Find whichever seed-bag tag's consumesInto names this sowing ticket —
    // the plan's draft slug (seed-bag-<crop>) got renamed during
    // implementation to satisfy the "slug is the name, slugified" rule, so
    // this searches by BEHAVIOR (consumesInto) rather than assuming a slug.
    const bagSlug = Object.keys(tags).find(
      (slug) => Array.isArray(tags[slug].consumesInto) && tags[slug].consumesInto.includes(sowing),
    );
    assert.ok(bagSlug, `no tag in docs/tags.yaml has consumesInto including "${sowing}" — the seed bag for "${crop}" is missing or miswired`);
    assert.equal(tags[bagSlug].group, "items-seeds", `seed bag "${bagSlug}" should be in the items-seeds group`);
  }
});
