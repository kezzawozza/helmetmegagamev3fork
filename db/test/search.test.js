// The pure half of searching (db/lib/search.js). Four things worth pinning:
// the reveal arithmetic, which is the whole mechanic and which no player can
// ever check because the die is never shown; the hideable set, which is an
// allowlist over a four-state enum; that a HOOD does not refuse a search, which
// is the one place this verb deliberately differs from Kiss; and SEARCH_SELECT's
// key set, because it overrides IDENTITY_SELECT's `tags` and a dropped field
// there fails silently and in the dangerous direction.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  revealCount,
  pickRevealed,
  hideableHoldings,
  searchableHoldings,
  searchAuthority,
  searchReadout,
  SEARCH_SELECT,
} = require("../lib/search");
const { hideableFromSearch } = require("../lib/medicalVision");
const { INCAPACITATING_SLUGS } = require("../lib/incapacitation");

const HERE = "loc-1";

const tag = (slug, over = {}) => ({
  tagId: `tag-${slug}`,
  quantity: 1,
  equipped: false,
  tag: {
    id: `tag-${slug}`,
    slug,
    name: slug,
    tradeable: true,
    inspectVisibility: "HIDDEN",
    weightLbs: 1,
    concealsIdentity: false,
    concealSprite: null,
    forcesConceal: false,
    equipLayer: null,
    forcedName: null,
    ...over,
  },
});

const person = (over = {}) => ({
  id: "c1",
  name: "Ada",
  status: "ALIVE",
  locationId: HERE,
  concealed: false,
  gender: "WOMAN",
  tags: [],
  ...over,
});

// ── The arithmetic ─────────────────────────────────────────────────────────

test("a 6 gives up every hidden thing, a 1 gives up none", () => {
  assert.equal(revealCount(6, 5), 5);
  assert.equal(revealCount(1, 5), 0);
});

test("the count is floor(die / 6 * hidden), across every face", () => {
  for (let die = 1; die <= 6; die += 1) {
    for (let hidden = 0; hidden <= 12; hidden += 1) {
      assert.equal(revealCount(die, hidden), Math.floor((die / 6) * hidden));
    }
  }
});

// This is the texture of the whole verb and it is the opposite of what a
// player would guess, so it is pinned rather than left to arithmetic: hiding
// ONE thing holds it on anything but a 6, while hiding five gives two away on
// a 3. Nobody can work this out from play, which is why SEARCH.md says it out
// loud and the picker prints a line about it.
test("hiding one thing is stronger than hiding five", () => {
  for (let die = 1; die <= 5; die += 1) assert.equal(revealCount(die, 1), 0);
  assert.equal(revealCount(6, 1), 1);
  assert.equal(revealCount(3, 5), 2);
});

test("nothing hidden reveals nothing, whatever the die", () => {
  for (let die = 1; die <= 6; die += 1) assert.equal(revealCount(die, 0), 0);
});

test("pickRevealed takes the count asked for, never a duplicate", () => {
  const hidden = ["a", "b", "c", "d", "e"].map((n) => ({ tagId: n }));
  for (let want = 0; want <= 5; want += 1) {
    const got = pickRevealed(hidden, want, () => 0.5);
    assert.equal(got.length, want);
    assert.equal(new Set(got.map((r) => r.tagId)).size, want);
    for (const row of got) assert.ok(hidden.includes(row));
  }
});

test("pickRevealed never takes more than there is, and leaves the source alone", () => {
  const hidden = [{ tagId: "a" }, { tagId: "b" }];
  assert.equal(pickRevealed(hidden, 9, () => 0).length, 2);
  assert.equal(hidden.length, 2);
  assert.equal(hidden[0].tagId, "a");
});

test("pickRevealed can reach every item, so hiding order steers nothing", () => {
  const hidden = ["a", "b", "c"].map((n) => ({ tagId: n }));
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) {
    for (const row of pickRevealed(hidden, 1)) seen.add(row.tagId);
  }
  assert.deepEqual([...seen].sort(), ["a", "b", "c"]);
});

// ── What may be hidden ─────────────────────────────────────────────────────

test("HIDDEN and WORN may be hidden; ALWAYS and NAMED may not", () => {
  assert.equal(hideableFromSearch({ inspectVisibility: "HIDDEN" }), true);
  assert.equal(hideableFromSearch({ inspectVisibility: "WORN" }), true);
  assert.equal(hideableFromSearch({ inspectVisibility: "ALWAYS" }), false);
  assert.equal(hideableFromSearch({ inspectVisibility: "NAMED" }), false);
});

// The allowlist fails closed by REVEALING rather than by hiding, which is the
// opposite of seenByBystander's direction. An unknown value must not become
// concealable by accident.
test("an unknown visibility is not hideable", () => {
  assert.equal(hideableFromSearch({ inspectVisibility: "SOMETHING_NEW" }), false);
  assert.equal(hideableFromSearch({}), false);
  assert.equal(hideableFromSearch(null), false);
});

test("a worn WORN item is still hideable — being visible is not being safe", () => {
  const rows = hideableHoldings([tag("dagger", { inspectVisibility: "WORN" })]);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["dagger"],
  );
});

test("only cargo is at stake: a skill or an injury is not searchable", () => {
  const held = [
    tag("dagger"),
    tag("broken-jaw", { tradeable: false }),
    tag("smithing", { tradeable: false, inspectVisibility: "ALWAYS" }),
  ];
  assert.deepEqual(
    searchableHoldings(held).map((r) => r.name),
    ["dagger"],
  );
  assert.deepEqual(
    hideableHoldings(held).map((r) => r.name),
    ["dagger"],
  );
});

test("an ALWAYS item is searched but can never be hidden", () => {
  const held = [tag("longbow", { inspectVisibility: "ALWAYS" }), tag("letter")];
  assert.deepEqual(
    searchableHoldings(held).map((r) => r.name),
    ["longbow", "letter"],
  );
  assert.deepEqual(
    hideableHoldings(held).map((r) => r.name),
    ["letter"],
  );
});

// ── Who may search whom ────────────────────────────────────────────────────

test("you cannot search yourself, the dead, or somebody elsewhere", () => {
  const me = person();
  assert.match(searchAuthority(me, me), /somebody else/i);
  assert.ok(searchAuthority(me, person({ id: "c2", status: "DEAD" })));
  assert.ok(searchAuthority(me, person({ id: "c2", locationId: "loc-2" })));
  assert.equal(searchAuthority(me, person({ id: "c2" })), null);
});

// The one place this verb deliberately parts company with Kiss, which refuses a
// covered face outright. A hood hides WHO you are, not what is in your pockets
// (PROXYING.md §5), so it must not be a refusal here.
test("a hood does not refuse a search, on either side", () => {
  const hood = tag("hood", { concealsIdentity: true, forcesConceal: true, equipLayer: 3 });
  hood.equipped = true;
  const hooded = person({ id: "c2", concealed: true, tags: [hood] });
  assert.equal(searchAuthority(person(), hooded), null);
  assert.equal(searchAuthority(person({ concealed: true, tags: [hood] }), person({ id: "c2" })), null);
});

test("anything that blocks ACT refuses it, from either end", () => {
  for (const slug of INCAPACITATING_SLUGS) {
    const stopped = [{ tag: { slug, name: slug } }];
    assert.ok(searchAuthority(person({ tags: stopped }), person({ id: "c2" })), `actor ${slug}`);
    assert.ok(searchAuthority(person(), person({ id: "c2", tags: stopped })), `target ${slug}`);
  }
});

// ── The readout ────────────────────────────────────────────────────────────

test("both sides are told the same things, and neither is told the die", () => {
  const out = searchReadout({
    searcherSeenAs: "a young man",
    targetSeenAs: "Ada",
    found: [{ name: "Dagger", quantity: 2 }],
    onShow: [{ name: "Longbow", quantity: 1 }],
  });
  assert.match(out.searcherLines, /You searched Ada\./);
  assert.match(out.searcherLines, /Dagger ×2/);
  assert.match(out.targetLines, /^A young man searched you\./);
  assert.match(out.targetLines, /Dagger ×2/);
  for (const line of [out.searcherLines, out.targetLines]) {
    assert.doesNotMatch(line, /\brolled?\b|\bdie\b|\bd6\b/i);
  }
});

test("an empty search says so rather than printing an empty list", () => {
  const out = searchReadout({ searcherSeenAs: "Bo", targetSeenAs: "Ada", found: [], onShow: [] });
  assert.match(out.searcherLines, /carrying nothing/i);
  assert.match(out.targetLines, /found nothing/i);
});

// ── The select ─────────────────────────────────────────────────────────────

// SEARCH_SELECT's `tags` OVERRIDES the one IDENTITY_SELECT declares, and both
// halves of it fail silently when dropped: without the concealment fields every
// hood reports as no hood, and without inspectVisibility hideableFromSearch
// reads undefined and — being an allowlist — makes everything unhideable.
test("SEARCH_SELECT carries what both the hood rule and the visibility rule need", () => {
  const fields = SEARCH_SELECT.tags.select.tag.select;
  for (const key of [
    "concealsIdentity",
    "concealSprite",
    "forcesConceal",
    "equipLayer",
    "forcedName",
    "inspectVisibility",
    "tradeable",
    "name",
  ]) {
    assert.equal(fields[key], true, `SEARCH_SELECT is missing ${key}`);
  }
  assert.equal(SEARCH_SELECT.tags.select.equipped, true);
  assert.equal(SEARCH_SELECT.tags.select.quantity, true);
});
