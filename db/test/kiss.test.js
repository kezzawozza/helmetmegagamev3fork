// The pure half of kissing (db/lib/kiss.js): who may kiss whom. Three things
// worth pinning: ACT implies KISS (db/lib/incapacitation.js#expandCaps), so
// the helpless are refused with no second list to maintain; mute keeps it
// (TAGS.md §5f); a covered face is DERIVED from concealsIdentity, never a
// slug list, so a new helmet is covered automatically.
const test = require("node:test");
const assert = require("node:assert/strict");
const { kissAuthority, kissBlock, KISS_SELECT, KISS_COOLDOWN_MS } = require("../lib/kiss");
const { blockerFor, KISS, ACT, INCAPACITATING_SLUGS } = require("../lib/incapacitation");
const { KISS_BLOCKING_SLUGS } = require("../lib/constants");

const HERE = "loc-1";

const tag = (slug, over = {}) => ({
  equipped: false,
  tag: { slug, name: slug, concealsIdentity: false, concealSprite: null, forcesConceal: false, equipLayer: null, ...over },
});
const hood = (slug = "hood", over = {}) => ({
  equipped: true,
  tag: {
    slug,
    name: "Hood",
    concealsIdentity: true,
    concealSprite: "hood",
    forcesConceal: true,
    equipLayer: 3,
    ...over,
  },
});

const person = (over = {}) => ({
  id: "A",
  name: "Ada",
  status: "ALIVE",
  locationId: HERE,
  concealed: false,
  buriedAt: null,
  discordUserId: "1",
  tags: [],
  ...over,
});
const other = (over = {}) => person({ id: "B", name: "Bo", discordUserId: "2", ...over });

test("two ordinary people standing together may kiss", () => {
  assert.equal(kissAuthority(person(), other()), null);
});

test("every helpless state refuses, through ACT rather than a second list", () => {
  for (const slug of INCAPACITATING_SLUGS) {
    assert.ok(blockerFor([tag(slug)], ACT), `${slug} should block ACT`);
    assert.ok(blockerFor([tag(slug)], KISS), `${slug} should block KISS`);
    assert.ok(kissAuthority(person(), other({ tags: [tag(slug)] })), `${slug} target should refuse`);
    assert.ok(kissAuthority(person({ tags: [tag(slug)] }), other()), `${slug} actor should refuse`);
  }
});

test("mute keeps the button — it takes the yell, not the mouth", () => {
  assert.equal(blockerFor([tag("mute")], KISS), null);
  assert.equal(kissAuthority(person(), other({ tags: [tag("mute")] })), null);
});

test("the mouth injuries refuse without touching ACT", () => {
  for (const slug of ["broken-jaw", "wired-jaw", "choking", "vomiting"]) {
    assert.equal(blockerFor([tag(slug)], ACT), null, `${slug} must not block ACT`);
    assert.ok(kissAuthority(person(), other({ tags: [tag(slug)] })), `${slug} should refuse a kiss`);
  }
});

test("the states with nobody home refuse", () => {
  for (const slug of ["asleep", "blind-drunk", "hallucinating", "madness", "sepsis", "pain-shock", "stupid"]) {
    assert.ok(kissAuthority(person(), other({ tags: [tag(slug)] })), `${slug} should refuse`);
  }
});

test("every fiction blocker refuses, from either side", () => {
  for (const slug of KISS_BLOCKING_SLUGS) {
    assert.ok(kissAuthority(person(), other({ tags: [tag(slug)] })), `${slug} target should refuse`);
    assert.ok(kissAuthority(person({ tags: [tag(slug)] }), other()), `${slug} actor should refuse`);
  }
});

test("taste, belief and appearance keep the button", () => {
  for (const slug of ["prudish", "eunuch", "pacifist", "saint", "chaplain", "pious", "ugly", "unhygienic", "disfigured", "leper", "pox", "consumptive", "demoness"]) {
    assert.equal(kissAuthority(person(), other({ tags: [tag(slug)] })), null, `${slug} should be allowed`);
  }
});

test("a covered face refuses both ways, derived from concealsIdentity", () => {
  assert.ok(kissAuthority(person({ tags: [hood()] }), other()));
  assert.ok(kissAuthority(person(), other({ tags: [hood()] })));
  assert.ok(kissAuthority(person(), other({ tags: [hood("brand-new-helm", { name: "Brand New Helm" })] })));
});

test("a hood in the pack is not a hood on the face", () => {
  const stowed = { ...hood(), equipped: false };
  assert.equal(kissAuthority(person(), other({ tags: [stowed] })), null);
});

test("the refusal names the tag rather than saying no", () => {
  const bound = kissBlock(person({ tags: [tag("bound", { name: "Bound" })] }), { self: true });
  assert.match(bound, /Bound/);
  assert.match(kissBlock(person({ tags: [hood()] }), { self: true }), /Hood/);
});

test("nobody kisses themselves, the dead, or somebody across the map", () => {
  const me = person();
  assert.ok(kissAuthority(me, me));
  assert.ok(kissAuthority(person(), other({ status: "DEAD" })));
  assert.ok(kissAuthority(person(), other({ locationId: "loc-2" })));
  assert.ok(kissAuthority(person({ locationId: null }), other()));
});

// The /conceal COLUMN is only a wish (PROXYING.md §5): concealment is what is
// over the face, derived at read time, so a row left `concealed: true` after the
// mask came off is an ordinary bare-faced person. Co-presence no longer refuses
// on the column either — every people-picker reaches a hood now, and the rule
// about mouths is what says no. The mask case is covered above.
test("the conceal column alone is not a covered face", () => {
  assert.equal(kissAuthority(person(), other({ concealed: true })), null);
});

// A refusal must never be an unmasking, so a hooded subject is "They" and the
// helmet is not named back at you.
test("a refusal about somebody hooded never names them", () => {
  const masked = other({ name: "Sir Alder", tags: [hood(), tag("bound", { name: "Bound" })] });
  const refusal = kissAuthority(person(), masked);
  assert.ok(refusal);
  assert.doesNotMatch(refusal, /Alder/);
  assert.match(kissBlock(other({ name: "Sir Alder", tags: [hood()] }), { self: false }), /face covered/);
});

test("KISS_SELECT carries what the rules actually read", () => {
  for (const field of ["id", "name", "status", "locationId", "concealed", "buriedAt", "discordUserId", "tags"]) {
    assert.ok(KISS_SELECT[field], `KISS_SELECT is missing ${field}`);
  }
  assert.equal(KISS_SELECT.tags.select.equipped, true);
  for (const field of ["slug", "name", "concealsIdentity", "concealSprite", "forcesConceal", "equipLayer"]) {
    assert.ok(KISS_SELECT.tags.select.tag.select[field], `KISS_SELECT tags missing ${field}`);
  }
});

test("the cooldown is two hours", () => {
  assert.equal(KISS_COOLDOWN_MS, 2 * 60 * 60 * 1000);
});
