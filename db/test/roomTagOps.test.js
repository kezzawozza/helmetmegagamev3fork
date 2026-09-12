// node --test over the room half of staged adjudication: db/lib/roomTagOps.js
// and db/lib/roomStash.js#addRoomResources. Run with `npm test --workspace=db`.
//
// WHAT A FAILURE HERE MEANS. These are the writes behind the adjudication
// desk's "+ Room" button (docs/systemdocs/ADJUDICATION.md §1) — a GM putting
// loot on a floor or taking it back off. Three of the cases below are rules
// that differ from the character path and would read as bugs to anyone who
// assumed tagOps.js applies: a non-stackable tag DOES stack on a floor, a
// timed tag MUST carry its expiry, and an over-large remove FAILS the row
// instead of quietly taking what is there.
//
// Prisma is faked rather than mocked wholesale, same shape and same caveat as
// riteSweep.test.js: a tiny in-memory store answering only the queries these
// paths actually make. When a test needs one it does not answer, teach it that
// query.
const test = require("node:test");
const assert = require("node:assert/strict");

const { validateRoomTagOps, applyRoomTagOpsInTx } = require("../lib/roomTagOps");
const { addRoomResources } = require("../lib/roomStash");

// ---- the fake ---------------------------------------------------------------

const ROOM_ID = "room-1";

function makeTx({ rooms = [{ id: ROOM_ID, resources: 0, destroysContents: false }], roomTags = [], tags = [] } = {}) {
  const store = { rooms, roomTags, tags };
  let nextId = 1;

  const findRoomTag = (where) =>
    store.roomTags.find(
      (rt) => rt.roomId === (where.roomId_tagId?.roomId ?? where.roomId) && rt.tagId === (where.roomId_tagId?.tagId ?? where.tagId),
    ) ?? null;

  return {
    store,
    // lockRoom's SELECT ... FOR UPDATE, and addRoomResources' clamped update.
    // Tagged-template call: (strings, ...values).
    $queryRaw(strings, ...values) {
      const sql = strings.join("?");
      if (sql.includes('UPDATE "Room"')) {
        const [roomId, amount] = [values[0], values[1]];
        const room = store.rooms.find((r) => r.id === roomId);
        if (!room) return Promise.resolve([]);
        const before = room.resources;
        room.resources = Math.max(0, before + amount);
        return Promise.resolve([{ before, after: room.resources }]);
      }
      return Promise.resolve([{ id: values[0] }]);
    },
    room: {
      findUnique: ({ where }) => Promise.resolve(store.rooms.find((r) => r.id === where.id) ?? null),
    },
    roomTag: {
      findUnique: ({ where }) => Promise.resolve(findRoomTag(where)),
      create: ({ data }) => {
        const row = { id: `rt-${nextId++}`, poisonedCount: 0, poisonPayload: null, expiresTurn: null, ...data };
        store.roomTags.push(row);
        return Promise.resolve(row);
      },
      update: ({ where, data }) => {
        const row = store.roomTags.find((rt) => rt.id === where.id);
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "increment" in value) row[key] = (row[key] ?? 0) + value.increment;
          else row[key] = value;
        }
        return Promise.resolve(row);
      },
      updateMany: ({ where, data }) => {
        const hit = store.roomTags.filter(
          (rt) =>
            rt.roomId === where.roomId &&
            rt.tagId === where.tagId &&
            (where.quantity?.gte == null || rt.quantity >= where.quantity.gte) &&
            (where.poisonedCount?.gte == null || rt.poisonedCount >= where.poisonedCount.gte) &&
            (where.poisonedCount?.lte == null || rt.poisonedCount <= where.poisonedCount.lte) &&
            (where.poisonPayload?.not === undefined || rt.poisonPayload !== where.poisonPayload.not),
        );
        for (const row of hit) {
          for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === "object" && "decrement" in value) row[key] = (row[key] ?? 0) - value.decrement;
            else row[key] = value;
          }
        }
        return Promise.resolve({ count: hit.length });
      },
      deleteMany: ({ where }) => {
        const before = store.roomTags.length;
        store.roomTags = store.roomTags.filter(
          (rt) =>
            !(
              rt.roomId === where.roomId &&
              rt.tagId === where.tagId &&
              (where.quantity?.lte == null || rt.quantity <= where.quantity.lte)
            ),
        );
        store.roomTags.forEach(() => {});
        return Promise.resolve({ count: before - store.roomTags.length });
      },
    },
    turn: { findFirst: () => Promise.resolve(null) },
    auditLog: { create: () => Promise.resolve({}) },
  };
}

// The fake's roomTags array is replaced by deleteMany, so read through the
// store rather than holding a reference to the original array.
const stackOf = (tx, tagId) => tx.store.roomTags.find((rt) => rt.tagId === tagId) ?? null;

const LONGBOW = { id: "t-bow", name: "Longbow", stackable: false, defaultDurationTurns: 0 };
const SAC = { id: "t-sac", name: "Graga Sac", stackable: true, defaultDurationTurns: 0 };
const STENCH = { id: "t-stench", name: "Stench", stackable: false, defaultDurationTurns: 3 };
const catalog = new Map([LONGBOW, SAC, STENCH].map((t) => [t.id, t]));
const TURN = { number: 7 };

// ---- validation -------------------------------------------------------------

test("a quantity above 1 is allowed on a non-stackable tag, unlike a character", () => {
  // The rule that separates this module from tagOps.js#validateTagOps. Two
  // players can each leave their Longbow on the same floor; the pin is about
  // what one character may HOLD, and is re-applied when somebody picks it up.
  assert.doesNotThrow(() => validateRoomTagOps([{ tagId: LONGBOW.id, op: "add", quantity: 2 }], catalog));
});

test("an unknown tag, a bad op and a fractional quantity are all refused", () => {
  assert.throws(() => validateRoomTagOps([{ tagId: "gone", op: "add" }], catalog), /no longer exists/);
  assert.throws(() => validateRoomTagOps([{ tagId: SAC.id, op: "patch" }], catalog), /add and remove/);
  assert.throws(() => validateRoomTagOps([{ tagId: SAC.id, op: "add", quantity: 0 }], catalog), /whole numbers/);
});

// ---- applying ---------------------------------------------------------------

test("a non-stackable tag reaches quantity 2 on a floor", async () => {
  const tx = makeTx();
  await applyRoomTagOpsInTx(tx, {
    roomId: ROOM_ID,
    ops: [{ tagId: LONGBOW.id, op: "add", quantity: 2 }],
    tagsById: catalog,
    openTurn: TURN,
  });
  assert.equal(stackOf(tx, LONGBOW.id).quantity, 2);
});

test("a timed tag carries an expiry, or the nightly sweep never takes it", async () => {
  // db/index.js' expiry sweep matches `expiresTurn <= turn.number`, so a null
  // here would make a 3-turn Stench permanent and silent.
  const tx = makeTx();
  await applyRoomTagOpsInTx(tx, {
    roomId: ROOM_ID,
    ops: [{ tagId: STENCH.id, op: "add" }],
    tagsById: catalog,
    openTurn: TURN,
  });
  // Last live turn, counted inclusive from the first — turnFormat.js#expiryFrom.
  assert.equal(stackOf(tx, STENCH.id).expiresTurn, TURN.number + STENCH.defaultDurationTurns - 1);
});

test("an untimed tag gets no expiry", async () => {
  const tx = makeTx();
  await applyRoomTagOpsInTx(tx, {
    roomId: ROOM_ID,
    ops: [{ tagId: SAC.id, op: "add", quantity: 3 }],
    tagsById: catalog,
    openTurn: TURN,
  });
  assert.equal(stackOf(tx, SAC.id).expiresTurn, null);
});

test("removes run before adds", async () => {
  // A GM swapping one thing for another must not have the add merged into the
  // stack the remove was about to take from.
  const tx = makeTx({ roomTags: [{ id: "rt-0", roomId: ROOM_ID, tagId: SAC.id, quantity: 2, poisonedCount: 0, poisonPayload: null, expiresTurn: null }] });
  const applied = await applyRoomTagOpsInTx(tx, {
    roomId: ROOM_ID,
    ops: [
      { tagId: SAC.id, op: "add", quantity: 5 },
      { tagId: SAC.id, op: "remove", quantity: 2 },
    ],
    tagsById: catalog,
    openTurn: TURN,
  });
  assert.deepEqual(applied.map((a) => a.op), ["remove", "add"]);
  assert.equal(stackOf(tx, SAC.id).quantity, 5);
});

test("removing more than the floor holds fails the row instead of taking what is there", async () => {
  const tx = makeTx({ roomTags: [{ id: "rt-0", roomId: ROOM_ID, tagId: SAC.id, quantity: 1, poisonedCount: 0, poisonPayload: null, expiresTurn: null }] });
  await assert.rejects(
    applyRoomTagOpsInTx(tx, {
      roomId: ROOM_ID,
      ops: [{ tagId: SAC.id, op: "remove", quantity: 4 }],
      tagsById: catalog,
      openTurn: TURN,
    }),
    /isn't 4 × Graga Sac here/,
  );
  // Nothing taken. The push runs this inside a transaction, so the throw is
  // what rolls the whole row back and stamps it Errored.
  assert.equal(stackOf(tx, SAC.id).quantity, 1);
});

test("a remove with no quantity takes the whole stack", async () => {
  const tx = makeTx({ roomTags: [{ id: "rt-0", roomId: ROOM_ID, tagId: SAC.id, quantity: 9, poisonedCount: 0, poisonPayload: null, expiresTurn: null }] });
  await applyRoomTagOpsInTx(tx, {
    roomId: ROOM_ID,
    ops: [{ tagId: SAC.id, op: "remove" }],
    tagsById: catalog,
    openTurn: TURN,
  });
  assert.equal(stackOf(tx, SAC.id), null);
});

// ---- the room's own ⬢ -------------------------------------------------------

test("a burn clamps at 0 and reports what actually moved", async () => {
  const tx = makeTx({ rooms: [{ id: ROOM_ID, resources: 2, destroysContents: false }] });
  assert.equal(await addRoomResources(tx, ROOM_ID, -5), -2);
  assert.equal(tx.store.rooms[0].resources, 0);
});

test("a mint into the Spillway goes nowhere, but a burn out of it still works", async () => {
  const tx = makeTx({ rooms: [{ id: ROOM_ID, resources: 4, destroysContents: true }] });
  assert.equal(await addRoomResources(tx, ROOM_ID, 10), 0);
  assert.equal(tx.store.rooms[0].resources, 4);
  assert.equal(await addRoomResources(tx, ROOM_ID, -1), -1);
  assert.equal(tx.store.rooms[0].resources, 3);
});

test("a zero delta writes nothing at all", async () => {
  const tx = makeTx({ rooms: [{ id: ROOM_ID, resources: 4, destroysContents: false }] });
  assert.equal(await addRoomResources(tx, ROOM_ID, 0), 0);
  assert.equal(tx.store.rooms[0].resources, 4);
});
