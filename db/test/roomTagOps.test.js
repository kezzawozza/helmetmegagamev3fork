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

// ⬢ are the `resources` tag now (db/lib/resourceStack.js), a RoomTag row like
// any other stack — there is no `Room.resources` column left to fake a raw
// UPDATE against. addRoomResources reaches it through the same
// tag.findUnique / roomTag.findUnique+create/update path as everything else
// below, so it needs no fake of its own beyond that tag existing.
const RESOURCES_TAG_ID = "t-resources";

function makeTx({ rooms = [{ id: ROOM_ID, destroysContents: false }], roomTags = [], tags = [] } = {}) {
  const store = { rooms, roomTags, tags };
  let nextId = 1;

  const findRoomTag = (where) =>
    store.roomTags.find(
      (rt) => rt.roomId === (where.roomId_tagId?.roomId ?? where.roomId) && rt.tagId === (where.roomId_tagId?.tagId ?? where.tagId),
    ) ?? null;

  return {
    store,
    // lockRoom's SELECT ... FOR UPDATE (db/lib/tagWrites.js). Tagged-template
    // call: (strings, ...values).
    $queryRaw(strings, ...values) {
      return Promise.resolve([{ id: values[0] }]);
    },
    room: {
      findUnique: ({ where }) => {
        const room = store.rooms.find((r) => r.id === where.id) ?? null;
        return Promise.resolve(room && { ...room, location: { zoneId: null } });
      },
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
      // A stack row taken to zero is deleted rather than kept at 0
      // (resourceStack.js#bumpStack, same rule as tagWrites.js) — a burn
      // clamped from below can delete by id directly.
      delete: ({ where }) => {
        const before = store.roomTags.length;
        store.roomTags = store.roomTags.filter((rt) => rt.id !== where.id);
        return Promise.resolve({ deleted: before - store.roomTags.length });
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
    // The economy ledger's two reads (db/lib/pricedTags.js#loadCache and
    // db/lib/gameState.js). Both hooks swallow their own errors by design, so
    // without these the tests would still pass — but they would be passing
    // over a ledger path that threw on every call, which is not the path the
    // push actually runs. None of the tags here carry a price, so the hook
    // correctly records nothing; what is being kept honest is that it gets
    // that far.
    tag: {
      findMany: () => Promise.resolve([]),
      findUnique: ({ where }) => Promise.resolve(where.slug === "resources" ? { id: RESOURCES_TAG_ID } : null),
    },
    gameState: { findUnique: () => Promise.resolve({ gameId: "game-test" }), findFirst: () => Promise.resolve({ gameId: "game-test" }) },
    economyEntry: { create: ({ data }) => Promise.resolve({ id: "econ-1", ...data }) },
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
  const tx = makeTx({
    rooms: [{ id: ROOM_ID, destroysContents: false }],
    roomTags: [{ id: "rt-res", roomId: ROOM_ID, tagId: RESOURCES_TAG_ID, quantity: 2, poisonedCount: 0, poisonPayload: null, expiresTurn: null }],
  });
  assert.equal(await addRoomResources(tx, ROOM_ID, -5), -2);
  assert.equal(stackOf(tx, RESOURCES_TAG_ID), null, "the stack is deleted, not left at 0");
});

test("a mint into the Spillway goes nowhere, but a burn out of it still works", async () => {
  const tx = makeTx({
    rooms: [{ id: ROOM_ID, destroysContents: true }],
    roomTags: [{ id: "rt-res", roomId: ROOM_ID, tagId: RESOURCES_TAG_ID, quantity: 4, poisonedCount: 0, poisonPayload: null, expiresTurn: null }],
  });
  assert.equal(await addRoomResources(tx, ROOM_ID, 10), 0);
  assert.equal(stackOf(tx, RESOURCES_TAG_ID).quantity, 4);
  assert.equal(await addRoomResources(tx, ROOM_ID, -1), -1);
  assert.equal(stackOf(tx, RESOURCES_TAG_ID).quantity, 3);
});

test("a zero delta writes nothing at all", async () => {
  const tx = makeTx({
    rooms: [{ id: ROOM_ID, destroysContents: false }],
    roomTags: [{ id: "rt-res", roomId: ROOM_ID, tagId: RESOURCES_TAG_ID, quantity: 4, poisonedCount: 0, poisonPayload: null, expiresTurn: null }],
  });
  assert.equal(await addRoomResources(tx, ROOM_ID, 0), 0);
  assert.equal(stackOf(tx, RESOURCES_TAG_ID).quantity, 4);
});
