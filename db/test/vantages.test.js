// The per-turn fog of war (db/lib/vantages.js) — what stays lit, and what a
// reader must treat as dark. Run with `npm test --workspace=db`.
//
// The two snapshot columns are the whole point of this file. A Vantage row
// carries the turn it was lit in and the zone it sits in, and every read
// filters on both, so a wipe that never ran leaves rows that are already
// invisible rather than a leak. These tests pin that, plus the rule that
// standing somewhere is never a row.
const test = require("node:test");
const assert = require("node:assert/strict");
const { lightVantage, vantagesFor, allVantages, dropVantages, expireVantages } = require("../lib/vantages");

// A stand-in for the two tables these functions touch. Small enough to read,
// and it enforces the unique([characterId, locationId]) the schema declares —
// which is what makes the upsert in lightVantage meaningful.
function fakePrisma({ openTurnId = "turn-2", rows = [] } = {}) {
  const store = rows.map((r) => ({ ...r }));
  const match = (row, where) => {
    if (!where) return true;
    if (where.characterId) {
      const c = where.characterId;
      if (typeof c === "string" && row.characterId !== c) return false;
      if (c?.in && !c.in.includes(row.characterId)) return false;
    }
    if (where.locationId && row.locationId !== where.locationId) return false;
    if (where.zoneId && row.zoneId !== where.zoneId) return false;
    if (typeof where.turnId === "string" && row.turnId !== where.turnId) return false;
    if (where.turnId?.not !== undefined && row.turnId === where.turnId.not) return false;
    return true;
  };
  const dress = (row) => ({
    ...row,
    location: { id: row.locationId, name: row.locationId, zoneId: row.zoneId, discordChannelId: `ch-${row.locationId}` },
    character: { id: row.characterId, discordUserId: `u-${row.characterId}`, discordMirrored: true, status: "ALIVE" },
  });
  return {
    store,
    turn: { findFirst: async () => (openTurnId ? { id: openTurnId } : null) },
    vantage: {
      findMany: async ({ where } = {}) => store.filter((r) => match(r, where)).map(dress),
      deleteMany: async ({ where } = {}) => {
        const keep = store.filter((r) => !match(r, where));
        const removed = store.length - keep.length;
        store.length = 0;
        store.push(...keep);
        return { count: removed };
      },
      upsert: async ({ where, create, update }) => {
        const key = where.characterId_locationId;
        const found = store.find((r) => r.characterId === key.characterId && r.locationId === key.locationId);
        if (found) {
          Object.assign(found, update);
          return dress(found);
        }
        const row = { id: `v${store.length + 1}`, ...create };
        store.push(row);
        return dress(row);
      },
    },
  };
}

const ADA = { id: "ada", zoneId: "town" };

test("walking out of a street lights it, under the open turn and its own zone", async () => {
  const prisma = fakePrisma();
  await lightVantage(prisma, {
    characterId: "ada",
    fromLocationId: "market",
    toLocationId: "gate",
    zoneId: "town",
    turnId: "turn-2",
  });
  assert.deepEqual(
    prisma.store.map((r) => [r.locationId, r.zoneId, r.turnId]),
    [["market", "town", "turn-2"]],
  );
});

test("standing somewhere is never a row — arriving clears any light on the destination", async () => {
  const prisma = fakePrisma({ rows: [{ id: "v1", characterId: "ada", locationId: "gate", zoneId: "town", turnId: "turn-2" }] });
  await lightVantage(prisma, {
    characterId: "ada",
    fromLocationId: "market",
    toLocationId: "gate",
    zoneId: "town",
    turnId: "turn-2",
  });
  assert.deepEqual(prisma.store.map((r) => r.locationId), ["market"], "walking back into a watched street makes it Here again");
});

test("without an open turn nothing is lit — a row with no turn could never be expired", async () => {
  const prisma = fakePrisma();
  await lightVantage(prisma, { characterId: "ada", fromLocationId: "market", toLocationId: "gate", zoneId: "town", turnId: null });
  assert.equal(prisma.store.length, 0);
});

test("a row lit in an earlier turn reads as dark", async () => {
  const prisma = fakePrisma({
    openTurnId: "turn-2",
    rows: [{ id: "v1", characterId: "ada", locationId: "market", zoneId: "town", turnId: "turn-1" }],
  });
  assert.deepEqual(await vantagesFor(prisma, ADA), []);
});

test("a row in a zone the character has since left reads as dark", async () => {
  const prisma = fakePrisma({
    rows: [{ id: "v1", characterId: "ada", locationId: "market", zoneId: "town", turnId: "turn-2" }],
  });
  assert.deepEqual(await vantagesFor(prisma, { id: "ada", zoneId: "forest" }), []);
  assert.equal((await vantagesFor(prisma, ADA)).length, 1, "and is lit again if she walks back — until the wipe catches it");
});

test("with no open turn at all, every light reads as out", async () => {
  const prisma = fakePrisma({
    openTurnId: null,
    rows: [{ id: "v1", characterId: "ada", locationId: "market", zoneId: "town", turnId: "turn-2" }],
  });
  assert.deepEqual(await vantagesFor(prisma, ADA), []);
});

test("the whole-game read drops a stale zone and skips web-only players", async () => {
  const prisma = fakePrisma({
    rows: [
      { id: "v1", characterId: "ada", locationId: "market", zoneId: "town", turnId: "turn-2" },
      { id: "v2", characterId: "bo", locationId: "mill", zoneId: "town", turnId: "turn-2" },
      { id: "v3", characterId: "cy", locationId: "quay", zoneId: "town", turnId: "turn-2" },
    ],
  });
  const alive = [
    { id: "ada", zoneId: "town", discordUserId: "u1", discordMirrored: true },
    { id: "bo", zoneId: "forest", discordUserId: "u2", discordMirrored: true }, // walked out of the zone
    { id: "cy", zoneId: "town", discordUserId: "u3", discordMirrored: false }, // holds no Discord access at all
  ];
  assert.deepEqual((await allVantages(prisma, alive)).map((r) => r.characterId), ["ada"]);
});

test("leaving the zone hands back every light so the caller can close the channels", async () => {
  const prisma = fakePrisma({
    rows: [
      { id: "v1", characterId: "ada", locationId: "market", zoneId: "town", turnId: "turn-2" },
      { id: "v2", characterId: "ada", locationId: "mill", zoneId: "town", turnId: "turn-2" },
      { id: "v3", characterId: "bo", locationId: "quay", zoneId: "town", turnId: "turn-2" },
    ],
  });
  const dropped = await dropVantages(prisma, "ada");
  assert.deepEqual(dropped.map((r) => r.location.discordChannelId).sort(), ["ch-market", "ch-mill"]);
  assert.deepEqual(prisma.store.map((r) => r.characterId), ["bo"], "nobody else's lights go out");
});

test("the turn shift keeps what this very push lit and expires the day before", async () => {
  const prisma = fakePrisma({
    rows: [
      { id: "v1", characterId: "ada", locationId: "market", zoneId: "town", turnId: "turn-1" },
      { id: "v2", characterId: "bo", locationId: "mill", zoneId: "town", turnId: "turn-2" }, // a relocation inside the push
    ],
  });
  const expired = await expireVantages(prisma, { keepTurnId: "turn-2" });
  assert.deepEqual(expired.map((r) => r.characterId), ["ada"]);
  assert.deepEqual(prisma.store.map((r) => r.id), ["v2"]);
});
