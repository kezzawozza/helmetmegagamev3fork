// The posted-target-key resolver. A picker on /character may offer somebody in a hood, and that row
// carries a TOKEN rather than a Character.id — /api/avatar/<id> answers with a face, so shipping the
// id to the browser is the unmasking. This is the one place a key becomes an id again.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";

const { splitTargetKey, resolveTargetKey } = require("../lib/targetKey");
const { hoodToken } = require("../lib/hoodToken");

const base = { status: "ALIVE", updatedAt: new Date(1700000000000), roleTitle: null };
const hoodTag = {
  equipped: true,
  tag: { forcedName: null, name: "Thanati Mask", concealsIdentity: true, concealSprite: "silvermask", forcesConceal: true, equipLayer: 1 },
};
const viewer = { id: "me", locationId: "loc1" };
const rows = [
  { ...base, id: "plain1", name: "Horvath", locationId: "loc1", concealed: false, age: 30, gender: "MAN", tags: [] },
  { ...base, id: "hood1", name: "Oleg", locationId: "loc1", concealed: false, age: 40, gender: "MAN", tags: [hoodTag] },
];
const fakePrisma = { character: { findMany: async () => rows } };

test("a plain id passes through, with or without the character: prefix", () => {
  assert.deepEqual(splitTargetKey("character:abc"), { kind: "character", value: "abc" });
  assert.deepEqual(splitTargetKey("abc"), { kind: "character", value: "abc" });
});

test("a hood key is recognised, through the character: prefix a PartySelect adds", () => {
  assert.deepEqual(splitTargetKey("hood:deadbeef"), { kind: "hood", value: "deadbeef" });
  assert.deepEqual(splitTargetKey("character:hood:deadbeef"), { kind: "hood", value: "deadbeef" });
});

test("a hood token resolves to the character standing behind it", async () => {
  const id = await resolveTargetKey(fakePrisma, viewer, `hood:${hoodToken("hood1")}`, { sightings: new Map() });
  assert.equal(id, "hood1");
});

test("a hood token for somebody NOT standing here resolves to nobody", async () => {
  const id = await resolveTargetKey(fakePrisma, viewer, `hood:${hoodToken("elsewhere")}`, { sightings: new Map() });
  assert.equal(id, null);
});

test("an empty or missing key is nobody, never a lookup", async () => {
  assert.equal(await resolveTargetKey(fakePrisma, viewer, ""), null);
  assert.equal(await resolveTargetKey(fakePrisma, viewer, null), null);
});

test("a plain id is NOT run through the hood lookup — an unconcealed target still resolves", async () => {
  assert.equal(await resolveTargetKey(fakePrisma, viewer, "character:plain1"), "plain1");
});

// `allowDead` widens the HOOD arm only, and it has to be passed by the verb
// rather than assumed: Loot may name a body, Heal may not. A masked corpse is
// reachable exactly when the caller says a body is a legal target.
const deadRows = [
  {
    ...base,
    status: "DEAD",
    buriedAt: null,
    id: "body1",
    name: "Oleg",
    locationId: "loc1",
    concealed: false,
    age: 40,
    gender: "MAN",
    deathMaskTagId: "mask",
    // NOT equipped — death takes everything out of its slot, which is why the
    // stamp exists at all (db/lib/characterDeath.js).
    tags: [{ tagId: "mask", equipped: false, tag: { ...hoodTag.tag, id: "mask" } }],
  },
];
const fakeDeadPrisma = {
  character: {
    findMany: async ({ where }) =>
      where?.status === "ALIVE" ? deadRows.filter((r) => r.status === "ALIVE") : deadRows,
  },
};

test("a hood token over a body resolves only for a verb that allows one", async () => {
  const key = `hood:${hoodToken("body1")}`;
  const sightings = new Map();

  assert.equal(await resolveTargetKey(fakeDeadPrisma, viewer, key, { sightings }), null);
  assert.equal(
    await resolveTargetKey(fakeDeadPrisma, viewer, key, { sightings, allowDead: true }),
    "body1",
  );
});

test("allowDead never widens a plain character key — that stays the caller's own isHere()", async () => {
  assert.equal(await resolveTargetKey(fakeDeadPrisma, viewer, "character:body1", { allowDead: false }), "body1");
});
