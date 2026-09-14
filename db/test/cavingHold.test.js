// The hold a Caving 1 puts on a caver for the rest of the turn
// (docs/systemdocs/CAVING.md §2c). cavingHoldFor is a query rather than a
// pure comparison, so prisma is stubbed down to the one call each function
// makes — which also pins the WHERE, since the whole rule is in it: this
// character, this zone, TROUBLE, in the turn that is still open.
const test = require("node:test");
const assert = require("node:assert");

const { cavingHoldFor, cavingHeldIds, CAVING_HOLD_REASON } = require("../lib/cavingPass");
const { resolveNeighbors } = require("../lib/locationGraph");

function stubRolls(rows) {
  const seen = [];
  return {
    seen,
    cavingRoll: {
      findFirst: async ({ where }) => {
        seen.push(where);
        return rows[0] ?? null;
      },
      findMany: async ({ where }) => {
        seen.push(where);
        return rows;
      },
    },
  };
}

test("a TROUBLE row in this zone on the open turn is the refusal", async () => {
  const db = stubRolls([{ id: "roll1" }]);
  assert.equal(await cavingHoldFor(db, "char1", "depths"), CAVING_HOLD_REASON);
  // The whole rule is the WHERE. A QUIET row, a 1 rolled in some other zone, or
  // one from a turn already pushed must not come back from it — and NOT
  // resolvedAt: a GM's Mark resolved decides the encounter, but what was
  // decided only reaches the caver at the push, so it must not free them.
  assert.deepEqual(db.seen[0], {
    characterId: "char1",
    zoneId: "depths",
    kind: "TROUBLE",
    turn: { status: "OPEN" },
  });
});

test("no row means they may walk", async () => {
  assert.equal(await cavingHoldFor(stubRolls([]), "char1", "depths"), null);
});

test("nowhere to be held from is not a hold", async () => {
  const db = stubRolls([{ id: "roll1" }]);
  assert.equal(await cavingHoldFor(db, "char1", null), null);
  assert.equal(await cavingHoldFor(db, null, "depths"), null);
  assert.equal(db.seen.length, 0, "neither should have asked the database at all");
});

test("the party question is one query, and an empty party asks nothing", async () => {
  const db = stubRolls([{ characterId: "b" }]);
  const held = await cavingHeldIds(db, ["a", "b"], "depths");
  assert.equal(held.has("b"), true);
  assert.equal(held.has("a"), false);
  assert.equal(db.seen.length, 1);

  const empty = stubRolls([{ characterId: "b" }]);
  assert.equal((await cavingHeldIds(empty, [], "depths")).size, 0);
  assert.equal(empty.seen.length, 0);
});

// --- The picker: a hold takes the ways out of the zone, leaves the level open ---
const loc = (id, zoneId) => ({ id, zoneId, name: id, sortOrder: 0, zone: { sortOrder: 0, name: zoneId } });

function stubGraph({ rolls }) {
  return {
    locationLink: {
      findMany: async () => [
        { aId: "tunnel", bId: "gallery", a: loc("tunnel", "depths"), b: loc("gallery", "depths") },
        { aId: "tunnel", bId: "road", a: loc("tunnel", "depths"), b: loc("road", "town") },
      ],
    },
    cavingRoll: {
      findFirst: async () => (rolls ? { id: "roll1" } : null),
    },
  };
}

const CAVER = { id: "char1", zoneId: "depths", tags: [] };

test("a held caver may still walk the level, but not out of it", async () => {
  const rows = await resolveNeighbors(stubGraph({ rolls: true }), CAVER, "tunnel");
  const byId = Object.fromEntries(rows.map((r) => [r.location.id, r]));

  assert.equal(byId.gallery.passable, true, "the next room along stays open");
  assert.equal(byId.gallery.refusal, null);

  assert.equal(byId.road.passable, false, "the way out is shut");
  assert.equal(byId.road.refusal, CAVING_HOLD_REASON);
  assert.equal(byId.road.listed, true); // shut, not gone — same shape a locked gate uses
});

test("with the roll resolved, the way out opens again", async () => {
  const rows = await resolveNeighbors(stubGraph({ rolls: false }), CAVER, "tunnel");
  for (const row of rows) {
    assert.equal(row.passable, true);
    assert.equal(row.refusal, null);
  }
});
