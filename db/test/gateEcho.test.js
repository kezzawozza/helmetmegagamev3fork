// Talking through a gate (db/lib/gateEcho.js).
//
// WHAT A FAILURE HERE MEANS. Either a line said behind a door leaks out
// through a gate — a watchtower, a Conversation, a soundproof room heard on
// the road — or a line said in the open at a gate never reaches the people
// standing on the other side of the bars.
const test = require("node:test");
const assert = require("node:assert/strict");

const { echoRoomsFor, echoContent } = require("../lib/gateEcho");

const ROOMS = {
  gate: { id: "gate", kind: "PUBLIC", soundproof: false, locationId: "gatehouse" },
  tower: { id: "tower", kind: "PRIVATE", soundproof: false, locationId: "gatehouse" },
  quiet: { id: "quiet", kind: "PUBLIC", soundproof: true, locationId: "gatehouse" },
  inland: { id: "inland", kind: "PUBLIC", soundproof: false, locationId: "yard" },
  stretch: { id: "stretch", kind: "PUBLIC", soundproof: false, locationId: "road" },
  ledge: { id: "ledge", kind: "PRIVATE", soundproof: false, locationId: "road" },
};

const LINKS = [
  { aId: "gatehouse", bId: "road", modular: true, a: { id: "gatehouse" }, b: { id: "road" } },
  { aId: "gatehouse", bId: "yard", modular: false, a: { id: "gatehouse" }, b: { id: "yard" } },
];

function fakePrisma() {
  return {
    room: {
      findUnique: async ({ where }) => ROOMS[where.id] ?? null,
      findMany: async ({ where }) =>
        Object.values(ROOMS).filter(
          (r) =>
            where.locationId.in.includes(r.locationId) && r.kind === where.kind && r.soundproof === where.soundproof,
        ),
    },
    locationLink: {
      findMany: async ({ where }) => {
        const id = where.OR[0].aId;
        return LINKS.filter((l) => l.aId === id || l.bId === id);
      },
    },
  };
}

const ids = (rooms) => rooms.map((r) => r.id).sort();

test("a public room at a modular gate carries to the public rooms across it, and only those", async () => {
  assert.deepEqual(ids(await echoRoomsFor(fakePrisma(), "room:gate")), ["stretch"]);
  assert.deepEqual(ids(await echoRoomsFor(fakePrisma(), "room:stretch")), ["gate"]);
});

test("a private room, a soundproof room, a Conversation and a Location channel carry nowhere", async () => {
  for (const key of ["room:tower", "room:quiet", "room:ledge", "conv:abc", "loc:gatehouse", null]) {
    assert.deepEqual(await echoRoomsFor(fakePrisma(), key), [], String(key));
  }
});

test("a plain edge is not a gate", async () => {
  assert.deepEqual(ids(await echoRoomsFor(fakePrisma(), "room:inland")), []);
});

test("every line is subtext and mentions fold to plain names", () => {
  assert.equal(echoContent("Open up\n{char:abc|Ada} sent me"), "-# Open up\n-# Ada sent me");
  assert.equal(echoContent("{char:abc} is here"), "-# someone is here");
});
