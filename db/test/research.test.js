// node --test over the pure half of db/lib/research.js — the
// ingredient/recipe classification, the outcome thresholds and the
// auto:research marker. Run with `npm test --workspace=db`. Nothing here
// touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RESEARCH_MARKER_RE,
  researchMarker,
  researchableHeld,
  secretRecipesFor,
  researchOutcome,
  researchPaperText,
  familiarityBonus,
} = require("../lib/research");

// Fixture ingredients — bare Tag-shaped rows, as a catalog entry's
// requirementItems name them.
const tag = (slug, group = null) => ({ slug, name: slug.replace(/-/g, " "), group });

const oldCoin = tag("old-coin");
const nekkerPheromones = tag("nekker-pheromones");
const aberrantHeart = tag("aberrant-heart");
const holyWater = tag("holy-water");
const honey = tag("honey");
const saltpeter = tag("saltpeter");
const gragaSac = tag("graga-sac");
const corpse = tag("corpse-of-a-nobody", { slug: "items-corpse" });
const cloth = tag("cloth");
const gauze = tag("gauze");
const boots = tag("boots");

// requirementItems entry builders, mirroring db/lib/tagShapes.js's stored
// shapes ({kind:"tag"|"anyOf"|"group", ...}).
const item = (slug, keep = false) => ({ kind: "tag", slug, label: slug, keep });
const anyOf = (slugs, keep = false) => ({ kind: "anyOf", slugs, options: slugs.map((s) => ({ slug: s, name: s })), label: "anyOf", keep });
const group = (slug, label = slug) => ({ kind: "group", slug, label, keep: true });

// A recipe row, as loadResearchCatalog's select shapes it.
const recipe = (slug, catalogVisibility, items) => ({
  id: slug,
  slug,
  name: slug.replace(/-/g, " "),
  craftable: true,
  catalogVisibility,
  requirementItems: items,
});

// The real seven `catalog: gm` products (CRAFTING.md §2b), plus two
// public/secret recipes that exercise the exclusion rule, plus one
// synthetic GM recipe carrying an `anyOf` entry so all three match kinds
// are covered on a GM-visibility row.
const catalog = [
  recipe("minted-charm", "GM", [item("old-coin")]),
  recipe("heartforged-blade", "GM", [item("aberrant-heart")]),
  // Synthetic: no catalog: gm product takes honey any more, and the
  // exclusion test below needs one that does.
  recipe("gilded-draught", "GM", [item("holy-water"), item("honey")]),
  recipe("bone-mask", "GM", [group("items-corpse", "a corpse")]),
  recipe("death-mask", "GM", [group("items-corpse", "a corpse"), item("saltpeter")]),
  recipe("graga-hide-cloak", "GM", [item("graga-sac")]),
  // anyOf coverage: a GM recipe not among the real seven.
  recipe("arcane-band", "GM", [anyOf(["old-coin", "graga-sac"])]),
  // A public recipe naming a gm ingredient (honey): worthless as a reward
  // per CRAFTING.md §2b, since holding honey already reveals it in full elsewhere.
  recipe("lavish-meal", "ALL", [item("honey")]),
  // The cult's own content: hidden even from GMs, never dealt by research.
  recipe("forbidden-rite", "SECRET", [item("aberrant-heart")]),
  // A public anyOf recipe, to make sure anyOf on a non-GM row is excluded
  // the same way a tag/group entry would be.
  recipe("poultice", "ALL", [anyOf(["cloth", "gauze"])]),
  // A non-craftable row naming a real ingredient — must never surface as
  // researchable or as a secret, craftable or not.
  { ...recipe("uncraftable-thing", "GM", [item("old-coin")]), craftable: false },
];

function ct(t) {
  return { tag: t };
}

test("researchableHeld: every held tag that ingredients ANY craftable recipe, deduped and name-sorted", () => {
  const held = [
    ct(oldCoin),
    ct(aberrantHeart),
    ct(aberrantHeart), // held twice — must collapse to one entry
    ct(corpse),
    ct(cloth),
    ct(boots), // not an ingredient of anything craftable — excluded
  ];
  const result = researchableHeld(held, catalog);
  // Name-sorted: "aberrant heart" < "cloth" < "corpse of a nobody" < "old coin".
  assert.deepEqual(
    result.map((r) => r.tag.slug),
    ["aberrant-heart", "cloth", "corpse-of-a-nobody", "old-coin"],
  );
});

test("secretRecipesFor: kind=tag match, and SECRET is excluded even when the ingredient matches", () => {
  const found = secretRecipesFor(aberrantHeart, catalog).map((r) => r.slug);
  assert.deepEqual(found, ["heartforged-blade"]);
  assert.ok(!found.includes("forbidden-rite"), "SECRET-visibility recipes are never dealt by research");
});

test("secretRecipesFor: kind=anyOf match, GM-visibility only", () => {
  assert.deepEqual(
    secretRecipesFor(oldCoin, catalog).map((r) => r.slug).sort(),
    ["arcane-band", "minted-charm"],
  );
  assert.deepEqual(secretRecipesFor(gragaSac, catalog).map((r) => r.slug).sort(), [
    "arcane-band",
    "graga-hide-cloak",
  ]);
});

test("secretRecipesFor: kind=group match on the ingredient's own group slug", () => {
  assert.deepEqual(
    secretRecipesFor(corpse, catalog).map((r) => r.slug).sort(),
    ["bone-mask", "death-mask"],
  );
});

test("secretRecipesFor: excludes ALL-visibility recipes even though they name the ingredient", () => {
  const found = secretRecipesFor(honey, catalog).map((r) => r.slug);
  assert.deepEqual(found, ["gilded-draught"]);
  assert.ok(!found.includes("lavish-meal"), "a public recipe naming a gm ingredient is not a secret");
});

test("secretRecipesFor: an uncraftable row never counts, whatever its visibility", () => {
  const found = secretRecipesFor(oldCoin, catalog).map((r) => r.slug);
  assert.ok(!found.includes("uncraftable-thing"));
});

test("secretRecipesFor: an ingredient with no matching recipe at all returns nothing", () => {
  assert.deepEqual(secretRecipesFor(tag("tea"), catalog), []);
});

test("researchOutcome: thresholds", () => {
  assert.equal(researchOutcome({ total: 6, secrets: [{ slug: "x" }] }), "paper");
  assert.equal(researchOutcome({ total: 9, secrets: [{ slug: "x" }] }), "paper");
  // Rolled well, but this ingredient's whole pool is empty (or already
  // exhausted by the ledger test below): the shelves have nothing more to say.
  assert.equal(researchOutcome({ total: 6, secrets: [] }), "unlikely");
  assert.equal(researchOutcome({ total: 4, secrets: [] }), "unlikely");
  // A pool exists, but this roll didn't clear the paper threshold — no
  // "unlikely" line either, since there IS something left to find.
  assert.equal(researchOutcome({ total: 5, secrets: [{ slug: "x" }] }), "nothing");
  assert.equal(researchOutcome({ total: 3, secrets: [] }), "nothing");
  assert.equal(researchOutcome({ total: 3, secrets: [{ slug: "x" }] }), "nothing");
});

test("the caller drops already-revealed recipes before scoring the outcome", () => {
  // secretRecipesFor never sees the ledger — the turn-close pass
  // (db/lib/researchPass.js) is what subtracts AuditLog-ledgered recipe
  // slugs. Modelled here by filtering the pure result the same way that
  // pass does, to prove the empty-pool path degrades to "unlikely" rather
  // than "nothing" once every secret for an ingredient has already been
  // dealt.
  const revealed = new Set(["heartforged-blade"]);
  const remaining = secretRecipesFor(aberrantHeart, catalog).filter((r) => !revealed.has(r.slug));
  assert.deepEqual(remaining, []);
  assert.equal(researchOutcome({ total: 6, secrets: remaining }), "unlikely");
});

test("researchMarker / RESEARCH_MARKER_RE round-trip", () => {
  assert.equal(researchMarker("old-coin"), "auto:research:old-coin");
  assert.equal(RESEARCH_MARKER_RE.exec("auto:research:old-coin")[1], "old-coin");
});

test("RESEARCH_MARKER_RE matches on its own line after stagedPush.js appends auto:silent_close", () => {
  const gmNotes = ["auto:research:items-corpse", "auto:silent_close"].join("\n");
  const match = RESEARCH_MARKER_RE.exec(gmNotes);
  assert.ok(match, "marker must still be found once auto:silent_close is appended");
  assert.equal(match[1], "items-corpse");
});

test("RESEARCH_MARKER_RE matches when the research marker itself is not first on the line", () => {
  const gmNotes = ["some earlier GM note", "auto:research:graga-sac"].join("\n");
  assert.equal(RESEARCH_MARKER_RE.exec(gmNotes)[1], "graga-sac");
});

test("RESEARCH_MARKER_RE does not false-positive on a similarly-worded marker", () => {
  assert.equal(RESEARCH_MARKER_RE.exec("auto:researched:old-coin"), null);
  assert.equal(RESEARCH_MARKER_RE.exec("auto:lesson"), null);
});

test("researchPaperText: name, quoted description with tokens named, costs, escaped Requires rule", () => {
  const text = researchPaperText(
    {
      name: "White Honey",
      description: "Thick and pale. Eating it marks you {tag:high}.",
      requirementTurns: 3,
      requirementResources: 15,
      requirementSkills: [{ name: "Smithing II" }],
      requirementGambit: false,
      requirementItems: [
        { kind: "tag", slug: "holy-water", label: "Holy Water", keep: false },
        { kind: "tag", slug: "paper", label: "Paper", keep: false, count: 10 },
        { kind: "group", slug: "items-corpse", label: "a corpse", keep: true },
      ],
    },
    (slug) => (slug === "high" ? "High" : null),
  );
  assert.equal(
    text,
    [
      "White Honey",
      '"Thick and pale. Eating it marks you High."',
      "3 turns  \n15 ⬢  \nSmithing II",
      "\\- Requires -  \nHoly Water  \nPaper ×10  \na corpse (kept)",
    ].join("\n\n"),
  );
});

test("researchPaperText: an unresolvable token stays visible; empty blocks are omitted", () => {
  const text = researchPaperText({ name: "Bone Mask", description: "Marks you {tag:ghost}.", requirementItems: [] });
  assert.equal(text, 'Bone Mask\n\n"Marks you {tag:ghost}."');
});

test("familiarityBonus: counts earlier filings on the same ingredient, not this turn's, not other ingredients", () => {
  const d = (n) => new Date(2026, 8, n);
  const filed = [
    { turnId: "t1", createdAt: d(1), details: { ingredientSlug: "old-coin" } },
    { turnId: "t2", createdAt: d(2), details: { ingredientSlug: "old-coin" } },
    { turnId: "t2", createdAt: d(2), details: { ingredientSlug: "tea" } },
    { turnId: "t3", createdAt: d(3), details: { ingredientSlug: "old-coin" } },
  ];
  assert.equal(familiarityBonus({ filed, revealed: [], ingredientSlug: "old-coin", currentTurnId: "t3" }), 2);
  assert.equal(familiarityBonus({ filed, revealed: [], ingredientSlug: "tea", currentTurnId: "t3" }), 1);
  assert.equal(familiarityBonus({ filed: [], revealed: [], ingredientSlug: "old-coin", currentTurnId: "t1" }), 0);
});

test("familiarityBonus: resets at the last reveal of that ingredient only", () => {
  const d = (n) => new Date(2026, 8, n);
  const filed = [
    { turnId: "t1", createdAt: d(1), details: { ingredientSlug: "nekker-corpse" } },
    { turnId: "t2", createdAt: d(2), details: { ingredientSlug: "nekker-corpse" } },
    { turnId: "t3", createdAt: d(3), details: { ingredientSlug: "nekker-corpse" } },
    { turnId: "t4", createdAt: d(4), details: { ingredientSlug: "nekker-corpse" } },
  ];
  const revealed = [
    { createdAt: d(2), details: { ingredientSlug: "nekker-corpse", recipeSlug: "bone-mask" } },
    { createdAt: d(3), details: { ingredientSlug: "old-coin", recipeSlug: "minted-charm" } },
  ];
  // t1 and t2 sit at or before the corpse's reveal; only t3 counts toward t4.
  assert.equal(familiarityBonus({ filed, revealed, ingredientSlug: "nekker-corpse", currentTurnId: "t4" }), 1);
});
