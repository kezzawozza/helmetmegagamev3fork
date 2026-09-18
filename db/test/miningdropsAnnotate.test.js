// node --test over db/lib/miningdropsAnnotate.js. Nothing here touches
// Prisma or the filesystem — annotateLines takes plain rows and lines, so
// the whole cascading-EV/blurb-preservation contract is testable with
// synthetic data. A live-file smoke test (--write against a real db) is a
// second layer, not a replacement (see MININGDROPS.md §6a-§6b).
const test = require("node:test");
const assert = require("node:assert/strict");
const { annotateLines, priceRows, mechanicalValue, splitBlurb, ASSUMED_VALUES } = require("../lib/miningdropsAnnotate");

test("mechanicalValue: obol, a sellable tag, an unsellable tag, and non-tag entries", () => {
  const tagsById = new Map([
    ["t-obol", { slug: "obol", sellable: false, sellablePrice: null }],
    ["t-rope", { slug: "rope", sellable: true, sellablePrice: 4 }],
    ["t-bruised", { slug: "bruised", sellable: false, sellablePrice: null }],
  ]);
  assert.equal(mechanicalValue("obol", tagsById), "the coin itself, worth 1 ⬢");
  assert.equal(mechanicalValue("rope", tagsById), "sells 4 ⬢");
  assert.equal(mechanicalValue("bruised", tagsById), "not sellable");
  assert.equal(mechanicalValue("nothing", tagsById), null);
  assert.equal(mechanicalValue("Nothing", tagsById), null);
  assert.equal(mechanicalValue("+1", tagsById), null);
  assert.equal(mechanicalValue("-2", tagsById), null);
});

test("mechanicalValue: a non-sellable tag that pays out on consume falls back to consumesIntoResources", () => {
  const tagsById = new Map([
    ["t-purse", { slug: "purse", sellable: false, sellablePrice: null, consumesIntoResources: 3 }],
    // sellable wins if a tag somehow carries both — the direct sale is the
    // value a player actually sees on the counter.
    ["t-both", { slug: "both", sellable: true, sellablePrice: 9, consumesIntoResources: 3 }],
  ]);
  assert.equal(mechanicalValue("purse", tagsById), "worth 3 ⬢ consumed");
  assert.equal(mechanicalValue("both", tagsById), "sells 9 ⬢");
});

test("priceRows: evValue falls back to consumesIntoResources the same way mechanicalValue does", () => {
  const tagsById = new Map([
    ["t-purse", { slug: "purse", sellable: false, sellablePrice: null, consumesIntoResources: 3 }],
    ["t-bone", { slug: "bone", sellable: false, sellablePrice: null }],
  ]);
  const rows = [
    { kind: "TAG", tagId: "t-purse" },
    { kind: "TAG", tagId: "t-bone" },
  ];
  const [purseRow, boneRow] = priceRows(rows, tagsById);
  assert.equal(purseRow.evValue, 3);
  assert.equal(boneRow.evValue, 0);
});

test("mechanicalValue: a tag with neither sellablePrice nor consumesIntoResources falls back to ASSUMED_VALUES", () => {
  const tagsById = new Map([
    ["t-godflesh", { slug: "godflesh", sellable: false, sellablePrice: null, consumesIntoResources: null }],
    ["t-bone", { slug: "bone", sellable: false, sellablePrice: null }],
  ]);
  assert.equal(ASSUMED_VALUES.godflesh, 8);
  assert.equal(mechanicalValue("godflesh", tagsById), "assumed 8 ⬢ (not actually sellable yet)");
  // A tag with no entry in ASSUMED_VALUES still falls all the way to "not sellable".
  assert.equal(mechanicalValue("bone", tagsById), "not sellable");
});

test("mechanicalValue: the three monster corpses are assumed at what Butchering turns them into", () => {
  const tagsById = new Map([
    ["t-skinless", { slug: "skinless-corpse", sellable: false, sellablePrice: null }],
    ["t-graga", { slug: "graga-corpse", sellable: false, sellablePrice: null }],
    ["t-nekker", { slug: "nekker-corpse", sellable: false, sellablePrice: null }],
  ]);
  assert.equal(ASSUMED_VALUES["skinless-corpse"], 25);
  assert.equal(ASSUMED_VALUES["graga-corpse"], 8);
  assert.equal(ASSUMED_VALUES["nekker-corpse"], 5);
  assert.equal(mechanicalValue("skinless-corpse", tagsById), "assumed 25 ⬢ (not actually sellable yet)");
  assert.equal(mechanicalValue("graga-corpse", tagsById), "assumed 8 ⬢ (not actually sellable yet)");
  assert.equal(mechanicalValue("nekker-corpse", tagsById), "assumed 5 ⬢ (not actually sellable yet)");
});

test("mechanicalValue: the three smaller lockboxes (Silt, Buried, Netted) are worth their full contents", () => {
  const tagsById = new Map([
    ["t-silt", { slug: "silt-lockbox", sellable: true, sellablePrice: 9 }],
    ["t-buried", { slug: "buried-lockbox", sellable: true, sellablePrice: 12 }],
    ["t-netted", { slug: "netted-lockbox", sellable: true, sellablePrice: 9 }],
  ]);
  assert.equal(ASSUMED_VALUES["silt-lockbox"], 18);
  assert.equal(ASSUMED_VALUES["buried-lockbox"], 24);
  assert.equal(ASSUMED_VALUES["netted-lockbox"], 18);
  assert.equal(mechanicalValue("silt-lockbox", tagsById), "worth 18 ⬢ opened (sells 9 ⬢ locked)");
  assert.equal(mechanicalValue("buried-lockbox", tagsById), "worth 24 ⬢ opened (sells 12 ⬢ locked)");
  assert.equal(mechanicalValue("netted-lockbox", tagsById), "worth 18 ⬢ opened (sells 9 ⬢ locked)");
});

test("priceRows: evValue takes ASSUMED_VALUES first, ahead of a real sellablePrice/consumesIntoResources", () => {
  const tagsById = new Map([
    ["t-godflesh", { slug: "godflesh", sellable: false, sellablePrice: null, consumesIntoResources: null }],
    ["t-bone", { slug: "bone", sellable: false, sellablePrice: null }],
  ]);
  const rows = [
    { kind: "TAG", tagId: "t-godflesh" },
    { kind: "TAG", tagId: "t-bone" },
  ];
  const [godfleshRow, boneRow] = priceRows(rows, tagsById);
  assert.equal(godfleshRow.evValue, 8);
  assert.equal(boneRow.evValue, 0);
});

test("mechanicalValue + priceRows: a Lockbox's real (discounted) sellablePrice loses to its ASSUMED_VALUES contents value", () => {
  const tagsById = new Map([
    // Mirrors the real catalog shape: sellablePrice is deliberately HALF of
    // what's inside (Bascinet's call, 2026-09-10) — the override must win
    // over it, not the other way around, or a table's EV math would silently
    // halve itself the moment the tag became genuinely sellable.
    ["t-overspill", { slug: "overspill-lockbox", sellable: true, sellablePrice: 20 }],
  ]);
  assert.equal(ASSUMED_VALUES["overspill-lockbox"], 40);
  assert.equal(mechanicalValue("overspill-lockbox", tagsById), "worth 40 ⬢ opened (sells 20 ⬢ locked)");
  const [row] = priceRows([{ kind: "TAG", tagId: "t-overspill" }], tagsById);
  assert.equal(row.evValue, 40);
});

test("splitBlurb: preserves author text before ' — '", () => {
  assert.deepEqual(splitBlurb("# a coil left behind at an old camp — sells 4 ⬢", "sells 4 ⬢"), {
    blurb: "a coil left behind at an old camp",
  });
  assert.deepEqual(splitBlurb(null), { blurb: null });
});

test("splitBlurb: a bare comment matching today's mech value is a stale mechanical write, not a blurb", () => {
  assert.deepEqual(splitBlurb("# sells 4 ⬢", "sells 4 ⬢"), { blurb: null });
});

test("splitBlurb: a bare comment matching an EARLIER mech value is still a stale mechanical write, not a blurb (the sellablePrice-changed case)", () => {
  // Reproduces the knuckle-duster bug: sellablePrice moved from 21 to 30
  // between two --write runs. An exact match against today's "sells 30 ⬢"
  // would miss the old "sells 21 ⬢" and wrongly treat it as a hand blurb,
  // producing "# sells 21 ⬢ — sells 30 ⬢" instead of "# sells 30 ⬢".
  assert.deepEqual(splitBlurb("# sells 21 ⬢", "sells 30 ⬢"), { blurb: null });
  // Same shape check for the other mechanicalValue() formats.
  assert.deepEqual(splitBlurb("# worth 5 ⬢ consumed", "worth 8 ⬢ consumed"), { blurb: null });
  assert.deepEqual(
    splitBlurb("# worth 20 ⬢ opened (sells 10 ⬢ locked)", "worth 40 ⬢ opened (sells 20 ⬢ locked)"),
    { blurb: null },
  );
  assert.deepEqual(
    splitBlurb("# assumed 5 ⬢ (not actually sellable yet)", "assumed 8 ⬢ (not actually sellable yet)"),
    { blurb: null },
  );
});

test("splitBlurb: a bare comment with no separator, authored before any mechanical value existed, IS the blurb", () => {
  assert.deepEqual(splitBlurb("# a boar's tusk catches you", "not sellable"), {
    blurb: "a boar's tusk catches you",
  });
  // Also true with no mech at all (a RESOURCES entry never gets one).
  assert.deepEqual(splitBlurb("# a lucky find in the reeds", null), {
    blurb: "a lucky find in the reeds",
  });
});

// A minimal but real tree: global (1 tag, roll 6), location.caves-approach
// (roll 6, one entry), and zone.forest.requiresTag.forester (roll 6) — enough
// to exercise every node kind the walker handles (top, slugStep, rollLevel,
// rollLeaf, requiresTagMarker, skillLevel) in one pass.
function fixture() {
  const tagsById = new Map([
    ["t-obol", { id: "t-obol", slug: "obol", sellable: false, sellablePrice: null }],
    ["t-rope", { id: "t-rope", slug: "rope", sellable: true, sellablePrice: 4 }],
  ]);
  const tagIdBySlug = new Map([["obol", "t-obol"], ["rope", "t-rope"], ["forester", "t-forester"]]);
  const zoneIdBySlug = new Map([["forest", "z-forest"]]);
  const locationIdBySlug = new Map([["caves-approach", "l-caves"]]);

  const rows = [
    { roll: 6, zoneId: null, locationId: null, requiredTagId: null, kind: "TAG", tagId: "t-obol", rarity: "ultracommon", evValue: 1 },
    { roll: 6, zoneId: null, locationId: "l-caves", requiredTagId: null, kind: "RESOURCES", resourceAmount: 2, evValue: 2 },
    { roll: 6, zoneId: "z-forest", locationId: null, requiredTagId: "t-forester", kind: "TAG", tagId: "t-rope", rarity: "uncommon", evValue: 4 },
  ];

  const lines = [
    "global:",
    "  6:",
    "    - { slug: obol, rarity: ultracommon }",
    "",
    "location:",
    "  caves-approach:",
    '    6:',
    '      - "+2"',
    "",
    "zone:",
    "  forest:",
    "    requiresTag:",
    "      forester:",
    "        6:",
    "          - { slug: rope, rarity: uncommon }  # a coil left behind at an old camp",
    "",
  ];

  return { tagsById, tagIdBySlug, zoneIdBySlug, locationIdBySlug, rows, lines };
}

test("annotateLines: global's own roll comment shows one number (own == combined)", () => {
  const { lines, ...ctx } = fixture();
  const out = annotateLines(lines, ctx);
  const globalRoll = out.find((l) => l.startsWith("  6:"));
  assert.match(globalRoll, /^  6:\s+# EV 1\.00 ⬢ · hit 100%$/);
});

test("annotateLines: the location's roll 6 shows own AND combined (global's obol pools in)", () => {
  const { lines, ...ctx } = fixture();
  const out = annotateLines(lines, ctx);
  const line = out[6]; // '    6:' under location.caves-approach
  assert.match(line, /own EV 2\.00 ⬢ · hit 100%/);
  // Priced by BAND now, not by row count. The ⬢ delta holds `resources`'s
  // 0.20 at face 6 and nothing more — a consolation prize never absorbs the
  // slack — so the obol's `ultracommon` takes every absent band's share and
  // ends at 0.80: 1(0.80) + 2(0.20) = 1.20. Under the old uniform draw this
  // was (2 + 1) / 2 = 1.50.
  assert.match(line, /combined EV 1\.20 ⬢ · hit 100%/);
});

test("annotateLines: the category rollup is a true per-day EV — divided by all 6 faces, not the 1 configured one", () => {
  const { lines, ...ctx } = fixture();
  const out = annotateLines(lines, ctx);
  const categoryLine = out[5]; // '  hunting:'
  // Roll 6's combined EV is 1.20 (see the test above), rolls 1-5 are
  // unconfigured (0 EV each) — the rollup is 1.20/6, NOT 1.20 itself.
  assert.match(categoryLine, /⬢ EV\/day 0\.20 · hit 17%/);
});

test("annotateLines: forester's rollup folds in global AND zone.forest — the cascading case", () => {
  const { lines, ...ctx } = fixture();
  const out = annotateLines(lines, ctx);
  const forestLine = out[10]; // '  forest:'
  // Only Global(obol=1) pools at plain zone.forest on roll 6 (own EV 1.00);
  // divided across all 6 faces: 1.00 / 6.
  assert.match(forestLine, /⬢ EV\/day 0\.17 · hit 17%/);
  const foresterLine = out[12]; // '      forester:'
  // Global(obol, ultracommon) + the gated rope (uncommon). ultracommon is the
  // commonest band present so it absorbs every absent band's share (0.87);
  // the rope keeps uncommon's 0.13. 1(0.87) + 4(0.13) = 1.39 on roll 6
  // alone, divided across all six faces.
  assert.match(foresterLine, /⬢ EV\/day 0\.23 · hit 17%/);
});

test("annotateLines: preserves the author's blurb and appends the mechanical value", () => {
  const { lines, ...ctx } = fixture();
  const out = annotateLines(lines, ctx);
  const ropeLine = out[14];
  assert.equal(ropeLine, "          - { slug: rope, rarity: uncommon }  # a coil left behind at an old camp — sells 4 ⬢");
});

test("annotateLines: never touches a blank or comment-only line, or an empty-dict bucket", () => {
  const lines = ["global: {}", "", "# a standalone comment"];
  const out = annotateLines(lines, {
    rows: [],
    tagsById: new Map(),
    tagIdBySlug: new Map(),
    zoneIdBySlug: new Map(),
    locationIdBySlug: new Map(),
  });
  assert.deepEqual(out, lines);
});
