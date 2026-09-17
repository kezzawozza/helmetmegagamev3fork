// "Here": the one co-presence rule both faces judge by (db/lib/presence.js).
//
// The rule that matters most here is the one that changed: a hood hides WHO
// somebody is, never THAT they are standing there. Every verb that acts on a
// BODY passes `allowConcealed` and reaches a person in a mask; `hereWhere` stays
// strict because it is the NAMED half of the roster, and web/lib/peopleHere.js
// #hoodsHere is the other half.
const test = require("node:test");
const assert = require("node:assert/strict");

const { hereWhere, isHere, concealedNow } = require("../lib/presence");

const maskTag = (extra = {}) => ({
  equipped: true,
  tag: {
    id: "mask",
    name: "Knight's Helmet",
    concealsIdentity: true,
    concealSprite: "helm",
    forcesConceal: false,
    equipLayer: 1,
    forcedName: null,
    ...extra,
  },
});

const actor = { id: "me", locationId: "loc1" };
const there = (extra = {}) => ({ id: "them", locationId: "loc1", status: "ALIVE", concealed: false, tags: [], ...extra });

test("reaching yourself is free, and an unplaced actor reaches nobody", () => {
  assert.equal(isHere(actor, { ...actor }), true);
  assert.equal(isHere({ id: "me", locationId: null }, there()), false);
  assert.equal(isHere(actor, null), false);
});

test("co-presence is Location grain", () => {
  assert.equal(isHere(actor, there()), true);
  assert.equal(isHere(actor, there({ locationId: "loc2" })), false);
});

test("a mask refuses only the verbs that did not ask for one", () => {
  const masked = there({ concealed: true, tags: [maskTag()] });
  assert.equal(isHere(actor, masked), false, "the default is still the named half");
  assert.equal(isHere(actor, masked, { allowConcealed: true }), true, "every body-verb passes this");
});

// Concealment is what is over the face, derived at read time — never the column
// on its own (PROXYING.md §5). A row left `concealed: true` after the mask came
// off is an ordinary bare-faced person, and the reverse is the sack case.
test("the column alone hides, but a bare face under it is not concealment", () => {
  assert.equal(concealedNow(there({ concealed: true, tags: [] })), true, "the column is taken at its word without tags to check");
  assert.equal(concealedNow(there({ concealed: false, tags: [maskTag()] })), false, "a helmet worn by choice, toggle off");
  assert.equal(
    concealedNow(there({ concealed: false, tags: [maskTag({ forcesConceal: true })] })),
    true,
    "a sack tied on is not a choice",
  );
});

test("a mask in the pack is not a mask on the face", () => {
  const stowed = { ...maskTag(), equipped: false };
  assert.equal(concealedNow(there({ concealed: false, tags: [stowed] })), false);
});

test("a body is reachable only for a verb that allows one, and never once buried", () => {
  const body = there({ status: "DEAD", buriedAt: null });
  assert.equal(isHere(actor, body), false);
  assert.equal(isHere(actor, body, { allowDead: true }), true);
  assert.equal(isHere(actor, { ...body, buriedAt: new Date() }, { allowDead: true }), false);
});

test("hereWhere is the NAMED half: it drops hoods and keeps the unburied dead on request", () => {
  const living = hereWhere(actor);
  assert.equal(living.locationId, "loc1");
  assert.deepEqual(living.id, { not: "me" });
  assert.equal(living.OR.length, 1, "no dead branch unless asked");
  assert.equal(living.OR[0].concealed, false, "the column half of the hood filter");

  const withDead = hereWhere(actor, { includeDead: true });
  assert.equal(withDead.OR.length, 2);
  assert.deepEqual(withDead.OR[1], { status: "DEAD", buriedAt: null });
});
