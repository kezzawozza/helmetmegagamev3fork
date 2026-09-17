// Regression that catches a mood-tier drift M2a's own tests cannot: loads
// docs/tags.yaml fresh, walks the REAL normalizeTurnsCost (db/lib/tagShapes.js)
// to build the shape db/lib/mood.js#woundRungOf expects, and checks it
// against a FROZEN witness from before the Brewing rework — never against
// woundRungOf's own idea of the current catalog. Kept apart from
// mood.test.js's pure-unit fixtures so a failure here reads as "the catalog
// moved".
const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");
const yaml = require("js-yaml");
const { docsPath } = require("../lib/repoPaths");
const { entriesOf } = require("../lib/yamlEntries");
const { normalizeTurnsCost } = require("../lib/tagShapes");
const { woundRungOf } = require("../lib/mood");

// FROZEN ORACLE — pasted verbatim from planning/rework-specs/M3-expected.js.
// Every priced health tag mapped to the mood rung it carried BEFORE the
// Brewing rework. null = outside the three mood-bearing groups.
//
// DO NOT regenerate this from the current catalog or the current function —
// see M3.md. If an entry here looks wrong, that is a finding to report, not
// a table to edit.
const EXPECTED_WOUND_RUNGS = {
  "appendicitis": null,
  "arterial-bleed": 3.5,
  "blind": null,
  "blunt-force-trauma": 3,
  "broken-bone": 3,
  "broken-jaw": 4,
  "bruised": 1,
  "burned": 2,
  "cave-fever": null,
  "choking": null,
  "consumptive": null,
  "cracked-ribs": 3,
  "crippled-leg": 7,
  "crush-injury": 5,
  "deep-wound": 3,
  "disfigured": 6,
  "dislocated-shoulder": 0.5,
  "dying": 7,
  "envenomated": null,
  "exploded-chest": null,
  "festering": 4,
  "feverish": 5,
  "frostbite": 2,
  "grievous-wound": 5,
  "gut-wound": 6,
  "heatstroke": null,
  "hypothermia": null,
  "infected": 2,
  "lockjaw": 4,
  "mangled-hand": 4,
  "minor-bleeding": 0.5,
  "minor-wound": 2,
  "necrosis": 5,
  "pain-shock": null,
  "parasites": null,
  "phrygian-toxin": null,
  "poisoned": null,
  "pox": null,
  "punctured-lung": 6,
  "rot-lung": null,
  "sepsis": 7,
  "severe-bleeding": 3.5,
  "severe-burns": 4,
  "severe-pain": null,
  "sprained-ankle": 2,
  "stuffed": null,
};

// Every priced health tag in the CURRENT catalog, built via the real
// normalizeTurnsCost. Walked by `group:`, never file position — the health
// groups are non-contiguous in docs/tags.yaml.
//
// `cureRung` rides along because it is the authored answer since 9/2026. That
// changes what this oracle proves and it is worth being clear about: it used
// to prove the price-reading in woundRungOf still derived the right rung, and
// now it proves the rung somebody TYPED still matches the ladder the game
// shipped with. A fat-fingered `cureRung: 2` on a Moderate wound is exactly
// the kind of silent mood change it is here to catch.
function loadCurrentWoundRungs() {
  const yamlPath = docsPath("tags.yaml");
  if (!yamlPath) throw new Error("Cannot find docs/tags.yaml — see db/lib/repoPaths.js");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  const entries = entriesOf(doc?.tags, "slug").filter(
    (entry) => typeof entry.group === "string" && entry.group.startsWith("health") && entry.requirement,
  );
  const bySlug = new Map();
  for (const entry of entries) {
    const { requirementTurns, requirementPerTurn } = normalizeTurnsCost(entry.requirement, {
      slug: entry.slug,
      healable: entry.healable ?? false,
    });
    const shape = {
      groupSlug: entry.group,
      cureRung: entry.cureRung ?? null,
      requirementResources: entry.requirement?.resourceCost ?? null,
      requirementTurns,
      requirementPerTurn,
      requirementGambit: entry.requirement?.gambit ?? false,
    };
    bySlug.set(entry.slug, woundRungOf(shape));
  }
  return bySlug;
}

test("every priced health tag's mood rung still matches the pre-rework oracle", () => {
  const current = loadCurrentWoundRungs();
  const oracleSlugs = Object.keys(EXPECTED_WOUND_RUNGS);

  const currentSlugs = [...current.keys()].sort();
  const missing = oracleSlugs.filter((slug) => !current.has(slug));
  const added = currentSlugs.filter((slug) => !EXPECTED_WOUND_RUNGS.hasOwnProperty(slug));
  assert.deepEqual(
    missing,
    [],
    `oracle names ${missing.length} slug(s) no longer in the catalog: ${missing.join(", ")}`,
  );
  assert.deepEqual(
    added,
    [],
    `catalog has ${added.length} priced health tag(s) the oracle does not name: ${added.join(", ")} — ` +
      `this is expected to fail for a genuinely new tag; the fix is a deliberate update to ` +
      `planning/rework-specs/M3-expected.js (and this test's pasted copy) with a reason, not silently ignoring it`,
  );

  const disagreements = [];
  for (const slug of oracleSlugs) {
    const expected = EXPECTED_WOUND_RUNGS[slug];
    const actual = current.get(slug);
    if (actual !== expected) disagreements.push(`${slug}: expected rung ${expected}, got ${actual}`);
  }
  assert.deepEqual(disagreements, [], `wound(s) changed mood tier:\n${disagreements.join("\n")}`);
});

test("rung 5 (the 6-7 ⬢ band) has a direct woundRungOf assertion, not just catalog coverage", () => {
  const wound = (extra = {}) => ({
    groupSlug: "health-wounds",
    requirementResources: null,
    requirementTurns: null,
    requirementGambit: false,
    ...extra,
  });
  assert.equal(woundRungOf(wound({ requirementResources: 6 })), 5);
  assert.equal(woundRungOf(wound({ requirementResources: 7 })), 5);
});

// The two shape guarantees the decimal rework depends on. Both are cheap and
// both fail loudly if someone re-authors a cost the old way.
test("every health cost is a decimal on a quarter, and no health tag carries a work denominator", () => {
  const yamlPath = docsPath("tags.yaml");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  const entries = entriesOf(doc?.tags, "slug").filter(
    (entry) => typeof entry.group === "string" && entry.group.startsWith("health") && entry.requirement,
  );
  const offenders = [];
  for (const entry of entries) {
    const { requirementTurns, requirementPerTurn } = normalizeTurnsCost(entry.requirement, {
      slug: entry.slug,
      healable: entry.healable ?? false,
    });
    if (requirementTurns != null && !Number.isInteger(requirementTurns * 4)) {
      offenders.push(`${entry.slug}: turnsCost ${requirementTurns} is not on a quarter`);
    }
    // requirementPerTurn is a ration and a ration only. A health tag holding
    // one would mean the work denominator came back, and woundRungOf would be
    // reading a column that no longer means what it used to.
    if (requirementPerTurn != null) {
      offenders.push(`${entry.slug}: carries requirementPerTurn ${requirementPerTurn}`);
    }
  }
  assert.deepEqual(offenders, [], `health cost shapes drifted:\n${offenders.join("\n")}`);
});

// The case the price can no longer answer, pinned directly: with no authored
// rung, an unknown 2-⬢ wound takes the gentler reading rather than inventing a
// severity. Simple and Moderate are both 2 ⬢ and both cost 0.25 now.
test("the fallback lands an unauthored 2-⬢ wound on rung 2, and a costlier one on rung 3", () => {
  const wound = (extra = {}) => ({
    groupSlug: "health-wounds",
    cureRung: null,
    requirementResources: 2,
    requirementTurns: null,
    requirementGambit: false,
    ...extra,
  });
  assert.equal(woundRungOf(wound({ requirementTurns: 0 })), 2);
  assert.equal(woundRungOf(wound({ requirementTurns: 0.25 })), 2);
  assert.equal(woundRungOf(wound({ requirementTurns: 0.5 })), 3);
  assert.equal(woundRungOf(wound({ requirementTurns: 1 })), 3);
  // An authored rung always wins over the fallback.
  assert.equal(woundRungOf(wound({ requirementTurns: 0.25, cureRung: 3 })), 3);
});
