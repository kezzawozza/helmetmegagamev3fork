// whosHere()'s `withAcross`: the people seen through a modular gate.
//
// WHAT A FAILURE HERE MEANS. A far-side hood that carries a token is a person
// across a gate that Transfer, Attack or an invite can reach — the bars stop
// being bars. And `across` appearing without the opt-in would put them in
// every picker that calls whosHere().
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";

const { whosHere, whosHereLines } = require("../lib/whosHere");

const hood = {
  equipped: true,
  tag: { forcedName: null, name: "Hood", concealsIdentity: true, concealSprite: "hood", forcesConceal: true, equipLayer: 1 },
};
const base = { status: "ALIVE", updatedAt: new Date(1700000000000), roleTitle: null, concealed: true, age: 30, gender: "man" };

const PEOPLE = {
  gatehouse: [{ ...base, id: "guard", name: "Guard", concealed: false, tags: [] }],
  road: [
    { ...base, id: "ada", name: "Ada", concealed: false, tags: [] },
    { ...base, id: "masked", name: "Masked", tags: [hood] },
  ],
};

function fakePrisma() {
  return {
    character: { findMany: async ({ where }) => PEOPLE[where.locationId] ?? [] },
    locationLink: {
      findMany: async () => [{ aId: "gatehouse", a: { id: "gatehouse", name: "Gatehouse" }, b: { id: "road", name: "Road" } }],
    },
  };
}

const viewer = { id: "guard", locationId: "gatehouse" };

test("no across without the opt-in", async () => {
  const out = await whosHere(fakePrisma(), viewer, { sightings: new Map() });
  assert.equal(out.across, undefined);
});

test("the far side is listed by Location, and its hoods carry no token", async () => {
  const out = await whosHere(fakePrisma(), viewer, { sightings: new Map(), withAcross: true, withHoodIds: true });
  assert.equal(out.across.length, 1);
  const [road] = out.across;
  assert.equal(road.locationName, "Road");
  assert.deepEqual(road.named.map((p) => p.name), ["Ada"]);
  assert.equal(road.concealed.length, 1);
  assert.equal(road.concealed[0].token, null);
  assert.equal([...out.hoodIds.values()].includes("masked"), false);
  assert.match(whosHereLines(out).join("\n"), /\*\*Road:\*\* Ada \| /);
});
