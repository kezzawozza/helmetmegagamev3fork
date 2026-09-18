// Which role groups a name is painted in (db/lib/roleGroups.js#roleGroupHue),
// and the rule that keeps a colour from naming a seat nobody is supposed to be
// able to read. Run with `npm test --workspace=db`. Reads docs/roles.yaml off
// disk; no Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { roleGroupHue, COLOURED_GROUPS, ALL_GROUPS } = require("../lib/roleGroups");

test("the six estates are painted and the other two are not", () => {
  for (const slug of ["court", "clergy", "cerberon", "saviors", "business", "soil"]) {
    assert.equal(roleGroupHue(slug), slug);
  }
  assert.equal(roleGroupHue("outsiders"), null);
  assert.equal(roleGroupHue("other"), null);
});

test("no seat and a group nobody has heard of both read as no colour", () => {
  assert.equal(roleGroupHue(null), null);
  assert.equal(roleGroupHue(undefined), null);
  assert.equal(roleGroupHue("cabal"), null);
});

test("every coloured group is a real group", () => {
  const known = new Set(ALL_GROUPS.map((g) => g.slug));
  for (const slug of COLOURED_GROUPS) assert.ok(known.has(slug), `${slug} is not a role group`);
});

// The one that matters. A seat a look may not read must not be paintable, or
// its colour says in every scene what examine refuses to say once. It holds
// today because the Brigands sit under `outsiders` and the Tribunal under
// `other` — nothing but this test stops a re-bucketing in the YAML from
// quietly undoing it.
test("a seat nobody reads off a look is never painted either", () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, "..", "..", "docs", "roles.yaml"), "utf8"));
  const opaque = [];
  for (const [groupSlug, group] of Object.entries(doc?.groups ?? {})) {
    for (const [slug, role] of Object.entries(group ?? {})) {
      if (role?.examine_visible === false) opaque.push([slug, groupSlug]);
    }
  }
  assert.ok(opaque.length > 0, "docs/roles.yaml names no opaque seat at all — did the flag move?");
  for (const [slug, groupSlug] of opaque) {
    assert.equal(roleGroupHue(groupSlug), null, `${slug} is opaque to a look but its group ${groupSlug} is painted`);
  }
});
