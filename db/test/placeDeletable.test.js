// db/lib/placeDeletable.js — retiring and hard-deleting a Zone/Location/Room
// from /gm/dev/zones. Discord is faked at the seam discordMirrorApply.test.js
// uses: stub the exports on db/lib/discordRest itself, since placeDeletable.js
// requires that module as a whole rather than destructuring it. Run with
// `npm test --workspace=db`.
const test = require("node:test");
const assert = require("node:assert/strict");

const rest = require("../lib/discordRest");
const { retirePlace, hardDeleteBlockers, hardDeletePlace } = require("../lib/placeDeletable");

function stubDiscord() {
  const calls = [];
  const original = { deleteChannel: rest.deleteChannel, deleteThread: rest.deleteThread, deleteGuildRole: rest.deleteGuildRole };
  rest.deleteChannel = async (id) => calls.push(["deleteChannel", id]);
  rest.deleteThread = async (id) => calls.push(["deleteThread", id]);
  rest.deleteGuildRole = async (id) => calls.push(["deleteGuildRole", id]);
  return { calls, restore: () => Object.assign(rest, original) };
}

// A minimal fake covering exactly the counts/finds/writes placeDeletable.js
// issues. `counts` seeds every `<model>.count` call with a fixed answer;
// `rows` seeds `<model>.findUnique`/`update` targets.
function fakePrisma({ counts = {}, rows = {} } = {}) {
  const state = { deleted: [], updated: [] };
  const countFor = (model) => async () => counts[model] ?? 0;
  const findFor = (model) => async ({ where }) => rows[model]?.find((r) => r.id === where.id) ?? null;
  const model = (name) => ({
    count: countFor(name),
    findUnique: findFor(name),
    findFirst: async ({ where }) => {
      if (where.zoneId !== undefined || where.locationId !== undefined) {
        return (counts[`${name}.findFirst`] ?? 0) > 0 ? { id: "occupant" } : null;
      }
      return null;
    },
    update: async ({ where, data }) => {
      const row = rows[name]?.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      state.updated.push({ model: name, id: where.id, data });
      return row;
    },
    delete: async ({ where }) => {
      state.deleted.push({ model: name, id: where.id });
      return { id: where.id };
    },
  });
  return {
    state,
    zone: model("zone"),
    location: model("location"),
    room: model("room"),
    character: model("character"),
    vantage: model("vantage"),
    locationLink: model("locationLink"),
    structure: model("structure"),
    role: model("role"),
    threatSpawn: model("threatSpawn"),
    cavingRoll: model("cavingRoll"),
    quest: model("quest"),
    roomGuest: model("roomGuest"),
    playerThread: model("playerThread"),
    faction: model("faction"),
    roomTag: model("roomTag"),
  };
}

test("retiring a location with a living occupant is refused", async () => {
  const prisma = fakePrisma({ counts: { "character.findFirst": 1 }, rows: { location: [{ id: "l1", retiredAt: null }] } });
  const result = await retirePlace(prisma, "location", "l1");
  assert.equal(result.ok, false);
  assert.match(result.error, /living character/i);
});

test("retiring an empty location stamps retiredAt", async () => {
  const prisma = fakePrisma({ rows: { location: [{ id: "l1", retiredAt: null }] } });
  const result = await retirePlace(prisma, "location", "l1");
  assert.equal(result.ok, true);
  assert.ok(prisma.state.updated[0].data.retiredAt instanceof Date);
});

test("retiring an already-retired place is a no-op success", async () => {
  const already = new Date("2026-09-01T00:00:00Z");
  const prisma = fakePrisma({ rows: { location: [{ id: "l1", retiredAt: already }] } });
  const result = await retirePlace(prisma, "location", "l1");
  assert.equal(result.ok, true);
  assert.equal(result.alreadyRetired, true);
  assert.equal(prisma.state.updated.length, 0);
});

test("hardDeleteBlockers lists every reference to a room", async () => {
  const prisma = fakePrisma({
    counts: { roomGuest: 2, playerThread: 1, faction: 1, roomTag: 0 },
    rows: { room: [{ id: "r1", resources: 30, questId: null }] },
  });
  const blockers = await hardDeleteBlockers(prisma, "room", "r1");
  assert.equal(blockers.length, 4); // guests, conversation, faction, and the 30 ⬢ stash — not roomTag (0)
});

test("hardDeleteBlockers reports a nonzero stash and a minting quest too", async () => {
  const prisma = fakePrisma({
    rows: { room: [{ id: "r1", resources: 30, questId: "q1" }] },
  });
  const blockers = await hardDeleteBlockers(prisma, "room", "r1");
  assert.ok(blockers.some((b) => b.includes("30 ⬢")));
  assert.ok(blockers.some((b) => /quest minted this room/i.test(b)));
});

test("hardDeletePlace refuses when blockers exist, and touches nothing", async () => {
  const prisma = fakePrisma({ counts: { character: 1 }, rows: { location: [{ id: "l1" }] } });
  const { restore } = stubDiscord();
  try {
    const result = await hardDeletePlace(prisma, "location", "l1");
    assert.equal(result.ok, false);
    assert.ok(result.blockers.length > 0);
    assert.equal(prisma.state.deleted.length, 0);
  } finally {
    restore();
  }
});

test("hardDeletePlace on a clean room deletes the row and best-effort tears down its thread", async () => {
  const prisma = fakePrisma({ rows: { room: [{ id: "r1", discordThreadId: "thread-1", resources: 0, questId: null }] } });
  const { calls, restore } = stubDiscord();
  try {
    const result = await hardDeletePlace(prisma, "room", "r1");
    assert.equal(result.ok, true);
    assert.deepEqual(prisma.state.deleted, [{ model: "room", id: "r1" }]);
    assert.deepEqual(calls, [["deleteThread", "thread-1"]]);
  } finally {
    restore();
  }
});

test("hardDeletePlace never calls Discord for a room with no thread yet", async () => {
  const prisma = fakePrisma({ rows: { room: [{ id: "r1", discordThreadId: null, resources: 0, questId: null }] } });
  const { calls, restore } = stubDiscord();
  try {
    await hardDeletePlace(prisma, "room", "r1");
    assert.deepEqual(calls, []);
  } finally {
    restore();
  }
});
