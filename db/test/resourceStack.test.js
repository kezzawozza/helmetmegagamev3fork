// node --test over db/lib/resourceStack.js, the module every ⬢ balance is
// read and written through. Run with `npm test --workspace=db`.
//
// WHAT A FAILURE HERE MEANS. ⬢ stopped being an Int column in 9/2026 and
// became a stack row, which means the two things a column gave away for free
// now have to be written down and kept right:
//
//   the CLAMP — a debit larger than the balance takes what is there and
//   destroys the rest, never going negative. `addCharacterResources` reports
//   the shortfall so db/lib/moveEffects.js can book it as a CLAMP burn; if it
//   stopped reporting, real money destruction would go unrecorded and the
//   ledger's SINK total would quietly under-count (ECONOMY.md §4).
//
//   the CONDITIONAL WRITE — `take*` must be all-or-nothing in ONE statement,
//   never a read then a decrement. Prisma runs READ COMMITTED, so two
//   concurrent spenders each passing a separate read would both subtract and
//   a character would spend ⬢ they never had. The test below asserts the
//   SHAPE of that write, not just its result, because a read-then-write
//   refactor would keep every result here green while reintroducing the race.
//
// A row taken to zero is DELETED rather than left at 0 — otherwise every tag
// rail and Examine in the game would show "Resources ×0" forever.
//
// Prisma is faked rather than mocked wholesale, the same shape and the same
// caveat as roomTagOps.test.js: a tiny in-memory store answering only the
// queries these paths actually make. When a test needs one it does not
// answer, teach it that query.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RESOURCES_SLUG,
  resourcesOf,
  isResourcesRow,
  withoutResources,
  readCharacterResources,
  resourcesByCharacterIds,
  addCharacterResources,
  takeCharacterResources,
  takeRoomResources,
  setCharacterResources,
  invalidateResourcesTag,
} = require("../lib/resourceStack");

const TAG_ID = "t-resources";
const ME = "c-1";

// ---- the fake ---------------------------------------------------------------

function makeTx({ rows = [], tagMissing = false } = {}) {
  const store = { characterTag: rows.map((r) => ({ ...r })), roomTag: [], calls: [] };
  let nextId = 1;

  const key = (where, idField) => ({
    id: where[`${idField}_tagId`]?.[idField] ?? where[idField],
    tagId: where[`${idField}_tagId`]?.tagId ?? where.tagId,
  });

  function model(name, idField) {
    return {
      findUnique: ({ where }) => {
        const k = key(where, idField);
        return Promise.resolve(store[name].find((r) => r[idField] === k.id && r.tagId === k.tagId) ?? null);
      },
      findMany: ({ where }) =>
        Promise.resolve(
          store[name].filter((r) => r.tagId === where.tagId && (where[idField]?.in ?? []).includes(r[idField])),
        ),
      create: ({ data }) => {
        const row = { id: `row-${nextId++}`, ...data };
        store[name].push(row);
        return Promise.resolve(row);
      },
      update: ({ where, data }) => {
        const row = store[name].find((r) => r.id === where.id);
        for (const [k2, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in v) row[k2] = (row[k2] ?? 0) + v.increment;
          else if (v && typeof v === "object" && "decrement" in v) row[k2] = (row[k2] ?? 0) - v.decrement;
          else row[k2] = v;
        }
        return Promise.resolve(row);
      },
      updateMany: ({ where, data }) => {
        // Recorded so a test can assert the guard travelled WITH the write.
        store.calls.push({ model: name, where, data });
        const k = key(where, idField);
        const matched = store[name].filter(
          (r) =>
            r[idField] === k.id &&
            r.tagId === k.tagId &&
            (where.quantity?.gte === undefined || r.quantity >= where.quantity.gte),
        );
        for (const row of matched) row.quantity -= data.quantity.decrement;
        return Promise.resolve({ count: matched.length });
      },
      delete: ({ where }) => {
        store[name] = store[name].filter((r) => r.id !== where.id);
        return Promise.resolve({});
      },
      deleteMany: ({ where }) => {
        const before = store[name].length;
        store[name] = store[name].filter(
          (r) => !(r[idField] === where[idField] && r.tagId === where.tagId && r.quantity <= (where.quantity?.lte ?? 0)),
        );
        return Promise.resolve({ count: before - store[name].length });
      },
    };
  }

  return {
    store,
    tag: { findUnique: () => Promise.resolve(tagMissing ? null : { id: TAG_ID }) },
    characterTag: model("characterTag", "characterId"),
    roomTag: model("roomTag", "roomId"),
  };
}

const held = (quantity) => [{ id: "row-0", characterId: ME, tagId: TAG_ID, quantity }];
const quantityOf = (tx) => tx.store.characterTag.find((r) => r.characterId === ME)?.quantity ?? null;

// ---- reading ----------------------------------------------------------------

test("resourcesOf reads a full tag set and a filtered one alike, and 0 for neither", () => {
  assert.equal(resourcesOf({ tags: [{ quantity: 2, tag: { slug: "sword" } }, { quantity: 12, tag: { slug: RESOURCES_SLUG } }] }), 12);
  assert.equal(resourcesOf({ tags: [{ quantity: 7, tag: { slug: RESOURCES_SLUG } }] }), 7);
  assert.equal(resourcesOf({ tags: [{ quantity: 2, tag: { slug: "sword" } }] }), 0);
  assert.equal(resourcesOf({ tags: [] }), 0);
  assert.equal(resourcesOf(null), 0);
});

// The hazard this replaced: a row list carrying no `tag` used to fall through
// to "the first row's quantity", so a caller who selected { tagId, quantity }
// got an arbitrary tag's count back AS a ⬢ balance, silently.
test("resourcesOf refuses to guess: no slug on a row means that row is not ⬢", () => {
  assert.equal(resourcesOf({ tags: [{ quantity: 99 }] }), 0);
});

test("isResourcesRow and withoutResources accept both row shapes", () => {
  assert.equal(isResourcesRow({ tag: { slug: RESOURCES_SLUG } }), true);
  assert.equal(isResourcesRow({ slug: RESOURCES_SLUG }), true);
  assert.equal(isResourcesRow({ tag: { slug: "sword" } }), false);
  assert.deepEqual(withoutResources([{ tag: { slug: "sword" } }, { tag: { slug: RESOURCES_SLUG } }]), [
    { tag: { slug: "sword" } },
  ]);
  assert.deepEqual(withoutResources(), []);
});

test("a balance nobody holds reads 0, not null", async () => {
  assert.equal(await readCharacterResources(makeTx(), ME), 0);
});

test("resourcesByCharacterIds answers in one query, and omits who holds none", async () => {
  const tx = makeTx({
    rows: [
      { id: "a", characterId: "c-1", tagId: TAG_ID, quantity: 5 },
      { id: "b", characterId: "c-2", tagId: TAG_ID, quantity: 9 },
    ],
  });
  const map = await resourcesByCharacterIds(tx, ["c-1", "c-2", "c-3"]);
  assert.equal(map.get("c-1"), 5);
  assert.equal(map.get("c-2"), 9);
  assert.equal(map.get("c-3"), undefined, "absent, so a caller's ?? 0 decides");
});

// ---- the clamp --------------------------------------------------------------

test("a debit larger than the balance takes what is there and reports the shortfall", async () => {
  const tx = makeTx({ rows: held(2) });
  const result = await addCharacterResources(tx, ME, -5);
  assert.deepEqual(result, { before: 2, after: 0, moved: -2, clamped: 3 });
  assert.equal(quantityOf(tx), null, "emptied, so the row is gone");
});

test("a debit against nothing reports the whole amount as destroyed", async () => {
  const result = await addCharacterResources(makeTx(), ME, -4);
  assert.equal(result.moved, 0);
  assert.equal(result.clamped, 4, "moveEffects.js books this as a CLAMP burn");
});

test("a debit that fits leaves the row standing and destroys nothing", async () => {
  const tx = makeTx({ rows: held(10) });
  const result = await addCharacterResources(tx, ME, -4);
  assert.deepEqual(result, { before: 10, after: 6, moved: -4, clamped: 0 });
  assert.equal(quantityOf(tx), 6);
});

test("a credit creates the stack, then tops it up", async () => {
  const tx = makeTx();
  assert.deepEqual(await addCharacterResources(tx, ME, 3), { before: 0, after: 3, moved: 3 });
  assert.deepEqual(await addCharacterResources(tx, ME, 4), { before: 3, after: 7, moved: 4 });
  assert.equal(quantityOf(tx), 7);
});

// drawDrops sheds the newest-acquired units first, so a stack frozen at the
// moment its first unit landed would be the last thing an overfull character
// put down no matter how much arrived since (db/lib/carry.js).
test("a top-up bumps acquiredAt, which is what the Overburdened shed sorts by", async () => {
  const tx = makeTx({ rows: held(1) });
  await addCharacterResources(tx, ME, 1);
  assert.ok(tx.store.characterTag[0].acquiredAt instanceof Date);
});

test("a zero delta writes nothing", async () => {
  const tx = makeTx({ rows: held(4) });
  assert.deepEqual(await addCharacterResources(tx, ME, 0), { before: 4, after: 4, moved: 0 });
  assert.equal(tx.store.calls.length, 0);
});

// ---- the strict take --------------------------------------------------------

test("take is all or nothing: a short balance moves nothing and says so", async () => {
  const tx = makeTx({ rows: held(3) });
  assert.equal(await takeCharacterResources(tx, ME, 5), false);
  assert.equal(quantityOf(tx), 3, "untouched — moveParty turns this into InsufficientResourcesError");
});

test("take succeeds exactly at the balance, and deletes the emptied row", async () => {
  const tx = makeTx({ rows: held(5) });
  assert.equal(await takeCharacterResources(tx, ME, 5), true);
  assert.equal(quantityOf(tx), null);
});

// The point of the whole function. A read-then-decrement would pass every
// assertion above and still let two concurrent spenders both succeed.
test("the balance check IS the write: one guarded updateMany, not a read then a write", async () => {
  const tx = makeTx({ rows: held(10) });
  await takeCharacterResources(tx, ME, 4);
  const guarded = tx.store.calls.filter((c) => c.where.quantity?.gte === 4);
  assert.equal(guarded.length, 1, "the gte guard must travel in the same statement as the decrement");
  assert.deepEqual(guarded[0].data, { quantity: { decrement: 4 } });
});

test("taking nothing is a no-op that succeeds", async () => {
  const tx = makeTx();
  assert.equal(await takeCharacterResources(tx, ME, 0), true);
  assert.equal(tx.store.calls.length, 0);
});

test("a room's ⬢ take behaves the same as a character's", async () => {
  const tx = makeTx();
  tx.store.roomTag.push({ id: "r-0", roomId: "room-1", tagId: TAG_ID, quantity: 6 });
  assert.equal(await takeRoomResources(tx, "room-1", 9), false);
  assert.equal(await takeRoomResources(tx, "room-1", 6), true);
  assert.equal(tx.store.roomTag.length, 0);
});

// ---- absolute set -----------------------------------------------------------

test("setting a balance moves the difference, in both directions", async () => {
  const tx = makeTx({ rows: held(4) });
  assert.deepEqual(await setCharacterResources(tx, ME, 9), { before: 4, after: 9 });
  assert.equal(quantityOf(tx), 9);
  assert.deepEqual(await setCharacterResources(tx, ME, 2), { before: 9, after: 2 });
  assert.equal(quantityOf(tx), 2);
});

test("a negative set floors at zero rather than writing a negative stack", async () => {
  const tx = makeTx({ rows: held(3) });
  assert.deepEqual(await setCharacterResources(tx, ME, -5), { before: 3, after: 0 });
  assert.equal(quantityOf(tx), null);
});

// ---- the unsynced database --------------------------------------------------

// A half-synced database should degrade to a poor game, not a 500 on every
// page. Every helper treats a missing catalog tag as "nobody holds any ⬢".
test("with no `resources` tag in the catalog, reads are 0 and writes are refused", async () => {
  // The tag id is memoised for five minutes, and the tests above warmed it in
  // this same process. Drop it, or this case would answer from the cache and
  // never exercise the branch it is here for.
  invalidateResourcesTag();
  const tx = makeTx({ tagMissing: true });
  assert.equal(await readCharacterResources(tx, ME), 0);
  assert.deepEqual(await addCharacterResources(tx, ME, 5), { before: 0, after: 0, moved: 0 });
  assert.equal(await takeCharacterResources(tx, ME, 1), false);
  assert.equal((await resourcesByCharacterIds(tx, [ME])).size, 0);
});
