// Heightened Psychosis's drawback roll and the generic "package" picker
// (db/lib/reincarnate.js). Both take `prisma` as their first argument and do
// nothing but one `tag.findMany` plus in-memory filtering, so a bare
// `{ tag: { findMany } }` double stands in for the real client.
const test = require("node:test");
const assert = require("node:assert/strict");
const { pickPackageTags, rollDrawbackTags } = require("../lib/reincarnate");

function prismaOf(rows) {
  return { tag: { findMany: async () => rows } };
}

// --- pickPackageTags -------------------------------------------------------

test("no onlyRoleSlugs tags at all: nothing to choose", async () => {
  const picks = await pickPackageTags(prismaOf([]), "commoner");
  assert.deepEqual(picks, []);
});

test("a lone role-locked tag with no conflicting sibling is a perk, not a package", async () => {
  const rows = [{ id: "t1", slug: "vow-of-silence", pointCost: 0, conflictsWith: [] }];
  const picks = await pickPackageTags(prismaOf(rows), "minstrel");
  assert.deepEqual(picks, []);
});

test("a mutually-conflicting clique (Commoner's three kits) yields exactly one pick, every time", async () => {
  const rows = [
    { id: "farmer", slug: "commoner-farmer", pointCost: 0, conflictsWith: [{ id: "fisher" }, { id: "hunter" }] },
    { id: "fisher", slug: "commoner-fisherman", pointCost: 1, conflictsWith: [{ id: "farmer" }, { id: "hunter" }] },
    { id: "hunter", slug: "commoner-hunter", pointCost: 2, conflictsWith: [{ id: "farmer" }, { id: "fisher" }] },
  ];
  const seenSlugs = new Set();
  for (let i = 0; i < 200; i++) {
    const picks = await pickPackageTags(prismaOf(rows), "commoner");
    assert.equal(picks.length, 1, "exactly one member of the clique, never more, never zero");
    seenSlugs.add(picks[0].slug);
  }
  // Over 200 draws a uniform pick among 3 should have shown all three.
  assert.deepEqual([...seenSlugs].sort(), ["commoner-farmer", "commoner-fisherman", "commoner-hunter"]);
});

test("two independent groups for the same role each get their own pick", async () => {
  const rows = [
    { id: "a1", slug: "kit-a1", pointCost: 0, conflictsWith: [{ id: "a2" }] },
    { id: "a2", slug: "kit-a2", pointCost: 1, conflictsWith: [{ id: "a1" }] },
    { id: "b1", slug: "kit-b1", pointCost: 0, conflictsWith: [{ id: "b2" }] },
    { id: "b2", slug: "kit-b2", pointCost: 1, conflictsWith: [{ id: "b1" }] },
  ];
  const picks = await pickPackageTags(prismaOf(rows), "someRole");
  assert.equal(picks.length, 2);
  const slugs = picks.map((p) => p.slug).sort();
  assert.ok(slugs[0].startsWith("kit-a") || slugs[0].startsWith("kit-b"));
});

// --- rollDrawbackTags -------------------------------------------------------

const DRAWBACK_ROWS = [
  { id: "d1", slug: "corrupt", pointCost: -2, stackable: false, exclusive: false, groupId: null, requiredTagId: null, defaultDurationTurns: null, onlyRoleSlugs: ["cerberus"], excludedRoleSlugs: [], conflictsWith: [] },
  { id: "d2", slug: "limp", pointCost: -2, stackable: false, exclusive: false, groupId: null, requiredTagId: null, defaultDurationTurns: null, onlyRoleSlugs: [], excludedRoleSlugs: [], conflictsWith: [] },
  { id: "d3", slug: "devoted-follower", pointCost: -1, stackable: false, exclusive: false, groupId: null, requiredTagId: null, defaultDurationTurns: null, onlyRoleSlugs: [], excludedRoleSlugs: ["migrant"], conflictsWith: [] },
  { id: "d4", slug: "lazy", pointCost: -1, stackable: false, exclusive: false, groupId: null, requiredTagId: "laboring-basic-id", defaultDurationTurns: null, onlyRoleSlugs: [], excludedRoleSlugs: [], conflictsWith: [] },
  { id: "d5", slug: "vain", pointCost: -3, stackable: false, exclusive: true, groupId: "addictions", requiredTagId: null, defaultDurationTurns: null, onlyRoleSlugs: [], excludedRoleSlugs: [], conflictsWith: [] },
  { id: "d6", slug: "gambler", pointCost: -3, stackable: false, exclusive: true, groupId: "addictions", requiredTagId: null, defaultDurationTurns: null, onlyRoleSlugs: [], excludedRoleSlugs: [], conflictsWith: [{ id: "d2" }] },
  { id: "d7", slug: "prudish", pointCost: -2, stackable: false, exclusive: false, groupId: null, requiredTagId: null, defaultDurationTurns: null, onlyRoleSlugs: [], excludedRoleSlugs: [], conflictsWith: [] },
];

test("targetPoints of 0 (or less) rolls nothing, without even querying compatibility", async () => {
  const picks = await rollDrawbackTags(prismaOf(DRAWBACK_ROWS), { roleSlug: "migrant", grantedIds: [], targetPoints: 0 });
  assert.deepEqual(picks, []);
});

test("never overshoots the target, across many random draws", async () => {
  for (let i = 0; i < 300; i++) {
    const picks = await rollDrawbackTags(prismaOf(DRAWBACK_ROWS), { roleSlug: "someRole", grantedIds: [], targetPoints: 8 });
    const total = picks.reduce((sum, t) => sum + Math.abs(t.pointCost), 0);
    assert.ok(total <= 8, `overshot: ${total} from [${picks.map((p) => p.slug)}]`);
  }
});

test("onlyRoleSlugs is an allowlist: Corrupt never lands outside its listed roles", async () => {
  for (let i = 0; i < 50; i++) {
    const picks = await rollDrawbackTags(prismaOf(DRAWBACK_ROWS), { roleSlug: "migrant", grantedIds: [], targetPoints: 20 });
    assert.ok(!picks.some((t) => t.slug === "corrupt"));
  }
});

test("excludedRoleSlugs is a blocklist: Devoted Follower never lands on a Migrant", async () => {
  for (let i = 0; i < 50; i++) {
    const picks = await rollDrawbackTags(prismaOf(DRAWBACK_ROWS), { roleSlug: "migrant", grantedIds: [], targetPoints: 20 });
    assert.ok(!picks.some((t) => t.slug === "devoted-follower"));
  }
});

test("a requiredTag not already held keeps Lazy off the sheet", async () => {
  for (let i = 0; i < 50; i++) {
    const picks = await rollDrawbackTags(prismaOf(DRAWBACK_ROWS), { roleSlug: "someRole", grantedIds: [], targetPoints: 20 });
    assert.ok(!picks.some((t) => t.slug === "lazy"));
  }
});

test("a satisfied requiredTag lets Lazy land", async () => {
  let sawLazy = false;
  for (let i = 0; i < 50; i++) {
    const picks = await rollDrawbackTags(prismaOf(DRAWBACK_ROWS), {
      roleSlug: "someRole",
      grantedIds: ["laboring-basic-id"],
      targetPoints: 20,
    });
    if (picks.some((t) => t.slug === "lazy")) sawLazy = true;
  }
  assert.ok(sawLazy, "Lazy should be reachable once its requiredTag is already held");
});

test("conflictsWith an already-granted tag is refused", async () => {
  for (let i = 0; i < 50; i++) {
    // d6 (gambler) conflicts with d2 (limp); pre-grant limp and gambler must never appear.
    const picks = await rollDrawbackTags(prismaOf(DRAWBACK_ROWS), { roleSlug: "someRole", grantedIds: ["d2"], targetPoints: 20 });
    assert.ok(!picks.some((t) => t.slug === "gambler"));
  }
});

test("only one exclusive tag per group ever lands together (Vain and Gambler never both)", async () => {
  for (let i = 0; i < 100; i++) {
    const picks = await rollDrawbackTags(prismaOf(DRAWBACK_ROWS), { roleSlug: "someRole", grantedIds: [], targetPoints: 20 });
    const exclusiveHits = picks.filter((t) => t.slug === "vain" || t.slug === "gambler");
    assert.ok(exclusiveHits.length <= 1, `both vain and gambler landed together: ${picks.map((p) => p.slug)}`);
  }
});

test("never picks the same tag twice, and never re-picks something already granted", async () => {
  for (let i = 0; i < 50; i++) {
    const picks = await rollDrawbackTags(prismaOf(DRAWBACK_ROWS), { roleSlug: "someRole", grantedIds: ["d1"], targetPoints: 20 });
    const slugs = picks.map((t) => t.slug);
    assert.equal(new Set(slugs).size, slugs.length);
    assert.ok(!slugs.includes("corrupt")); // d1, pre-granted (and role-gated off anyway)
  }
});

test("an exact-fit total of 2 is reachable with a single -2 tag", async () => {
  // Pool with just one -2 option and nothing smaller: must land exactly on 2, not undershoot to 0.
  const rows = [{ id: "x", slug: "limp", pointCost: -2, stackable: false, exclusive: false, groupId: null, requiredTagId: null, defaultDurationTurns: null, onlyRoleSlugs: [], excludedRoleSlugs: [], conflictsWith: [] }];
  const picks = await rollDrawbackTags(prismaOf(rows), { roleSlug: "someRole", grantedIds: [], targetPoints: 2 });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].slug, "limp");
});
