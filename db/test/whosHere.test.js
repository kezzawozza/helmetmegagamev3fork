// whosHere()'s `withHoodIds`: the server-only map from a hood's token back to
// the character behind it. It's a SIBLING key rather than an id on the rows
// themselves, since those rows go to a browser — /api/avatar/<id> answers
// with a face, so shipping one is unmasking whatever the page draws.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";

const { whosHere, resolveHoodToken, ONLINE_WINDOW_MS, isOnline } = require("../lib/whosHere");
const { hoodToken } = require("../lib/hoodToken");

function fakePrisma(rows) {
  return { character: { findMany: async () => rows } };
}

const base = { status: "ALIVE", updatedAt: new Date(1700000000000), roleTitle: null, factionId: null, faction: null };
const concealingTag = (extra = {}) => ({
  equipped: true,
  tag: {
    forcedName: null,
    name: "Knight's Helmet",
    concealsIdentity: true,
    concealSprite: "helm",
    forcesConceal: false,
    equipLayer: 1,
    ...extra,
  },
});

const plain = (id, name) => ({ ...base, id, name, concealed: false, age: 30, gender: "MAN", tags: [] });
const hood = (id, name) => ({ ...base, id, name, concealed: true, age: 20, gender: "MAN", tags: [concealingTag()] });
const sacked = (id, name) => ({ // wish OFF; a sack tied over the head is not a choice, and conceals anyway
  ...base,
  id,
  name,
  concealed: false,
  age: 60,
  gender: "WOMAN",
  tags: [concealingTag({ name: "Sack", forcesConceal: true })],
});
const beast = (id, name) => ({ // openly a Beast: named, not hidden, even under a helmet
  ...base,
  id,
  name,
  concealed: true,
  age: 40,
  gender: "MAN",
  tags: [
    concealingTag(),
    { equipped: true, tag: { forcedName: "Beast", name: "Apex Form", concealsIdentity: false, concealSprite: null, forcesConceal: false, equipLayer: 0 } },
  ],
});
const wishing = (id, name) => ({ ...base, id, name, concealed: true, age: 30, gender: "WOMAN", tags: [] }); // wish, nothing over the face

const viewer = { id: "viewer", locationId: "loc", factionId: null };

test("no hoodIds unless they are asked for", async () => {
  const { concealed, hoodIds } = await whosHere(fakePrisma([hood("h1", "Sir Alder")]), viewer);

  assert.equal(hoodIds, undefined, "an id must not ride along by default");
  assert.equal(concealed[0].alias, "a young man");
  assert.ok(!concealed[0].alias.includes("Alder"));
});

test("every token in the map names the character behind it", async () => {
  const prisma = fakePrisma([hood("h1", "Sir Alder"), sacked("s1", "Mira Holt")]);
  const { hoodIds } = await whosHere(prisma, viewer, { withHoodIds: true });

  assert.deepEqual(
    [...hoodIds],
    [
      [hoodToken("h1"), "h1"],
      [hoodToken("s1"), "s1"],
    ],
  );
});

test("the map is exactly the concealed list — no more, no fewer", async () => {
  const prisma = fakePrisma([
    hood("h1", "Sir Alder"),
    sacked("s1", "Mira Holt"),
    beast("b1", "Jorren Vask"),
    plain("p1", "Ann Vell"),
    wishing("w1", "Tomas Reeve"),
  ]);
  const { named, concealed, hoodIds } = await whosHere(prisma, viewer, { withHoodIds: true });

  assert.deepEqual(concealed.map((c) => c.token).sort(), [...hoodIds.keys()].sort());
  assert.deepEqual(named.map((c) => c.name).sort(), ["Ann Vell", "Beast", "Tomas Reeve"]);
  assert.deepEqual([...hoodIds.values()].sort(), ["h1", "s1"]);
});

test("a sack conceals without the column, and reads as what a stranger sees", async () => {
  const { concealed } = await whosHere(fakePrisma([sacked("s1", "Mira Holt")]), viewer);

  assert.equal(concealed.length, 1);
  assert.equal(concealed[0].alias, "an old woman");
});

test("includeSelf: false keeps you out of your own list", async () => {
  const prisma = fakePrisma([hood("viewer", "Me"), hood("h1", "Them")]);

  const both = await whosHere(prisma, viewer, { withHoodIds: true });
  assert.deepEqual([...both.hoodIds.values()], ["viewer", "h1"]);

  const others = await whosHere(prisma, viewer, { withHoodIds: true, includeSelf: false });
  assert.deepEqual([...others.hoodIds.values()], ["h1"]);
});

test("nowhere is nobody", async () => {
  const prisma = fakePrisma([hood("h1", "Sir Alder")]);
  const { named, concealed, hoodIds } = await whosHere(prisma, { id: "viewer", locationId: null }, { withHoodIds: true });

  assert.deepEqual(named, []);
  assert.deepEqual(concealed, []);
  assert.equal(hoodIds.size, 0);
});

// The lists that MINT a token decide who is hidden from the sighting, so the
// function that RESOLVES one has to as well: an unmasked hood, still offered
// under the old token, must still resolve.
test("a hood who unmasks after you heard them is still reachable by their token", async () => {
  const unmasked = plain("h1", "Sir Alder");
  const prisma = fakePrisma([unmasked]);
  const sightings = new Map([["h1", { seq: "1", name: "Young Man", concealed: true, avatarPath: null, unknownFace: false }]]);

  const { named, concealed } = await whosHere(prisma, viewer, { sightings });
  assert.deepEqual(named, [], "the sighting is what you know, not the bare face in front of you");
  assert.equal(concealed[0].alias, "a young man");

  const token = concealed[0].token;
  assert.equal(await resolveHoodToken(prisma, viewer, token, { sightings }), "h1");
});

test("a token names nobody once they have walked away", async () => {
  const token = hoodToken("h1");
  assert.equal(await resolveHoodToken(fakePrisma([]), viewer, token, { sightings: new Map() }), null);
});

test("a forced name's token resolves to nobody — a Beast is not hiding", async () => {
  const prisma = fakePrisma([beast("b1", "Jorren Vask")]);
  assert.equal(await resolveHoodToken(prisma, viewer, hoodToken("b1"), { sightings: new Map() }), null);
});

// The "online" badge's window (isOnline/ONLINE_WINDOW_MS) — used the website
// or sent a Discord message in the last hour (Character.lastSeenAt,
// db/lib/characterActivity.js#touchLastSeen).
test("no lastSeenAt at all reads offline", () => {
  assert.equal(isOnline(null), false);
  assert.equal(isOnline(undefined), false);
});

test("just inside the hour reads online", () => {
  const now = Date.now();
  const lastSeenAt = new Date(now - (ONLINE_WINDOW_MS - 1000));
  assert.equal(isOnline(lastSeenAt, now), true);
});

test("just outside the hour reads offline", () => {
  const now = Date.now();
  const lastSeenAt = new Date(now - (ONLINE_WINDOW_MS + 1000));
  assert.equal(isOnline(lastSeenAt, now), false);
});

test("exactly at the boundary reads offline — the window is a strict less-than", () => {
  const now = Date.now();
  const lastSeenAt = new Date(now - ONLINE_WINDOW_MS);
  assert.equal(isOnline(lastSeenAt, now), false);
});

test("a moment ago reads online", () => {
  const now = Date.now();
  assert.equal(isOnline(new Date(now - 1000), now), true);
});
