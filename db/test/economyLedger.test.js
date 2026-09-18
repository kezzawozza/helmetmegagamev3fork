// node --test over the economy ledger — db/lib/economyLedger.js and the two
// balance primitives in db/lib/resourceTransfer.js that write to it. Run with
// `npm test --workspace=db`.
//
// Nothing here touches Prisma. `fakeTx` below stands in for a transaction
// client: it holds balances in a Map and collects the EconomyEntry rows that
// would have been written, which is enough to assert the one property the
// whole /gm/economy panel rests on —
//
//   for every account, the sum of its ledger legs equals its live balance.
//
// A drift there means something moved money without telling the book, and the
// panel's reconciliation badge exists to catch exactly that. These tests are
// the same check run against the primitives in isolation.
const test = require("node:test");
const assert = require("node:assert/strict");
const { record, recordDelta, MINT, BURN, characterParty } = require("../lib/economyLedger");
const { moveParty, applyTransfer, InsufficientResourcesError } = require("../lib/resourceTransfer");

// ⬢ are a stack tag now (db/lib/resourceStack.js), held in a CharacterTag or
// RoomTag row rather than a `resources` column. resourceTransfer.js's
// moveParty/applyTransfer call through resourceStack.js, which itself calls
// tx.tag.findUnique (for the tag id) and tx.characterTag / tx.roomTag
// (findUnique/create/update/updateMany/deleteMany). This fake models those
// calls instead of a bare `resources` column — `bal` still gives every test
// below the same plain "current balance" view it always had, kept in sync as
// a side effect of the row writes underneath it.
const RESOURCES_TAG_ID = "tag_resources";

function fakeTx(balances = {}) {
  const bal = new Map(Object.entries(balances));

  // One party-tag store per model, keyed by the owning id — a CharacterTag or
  // RoomTag row for the `resources` tag specifically, since that's the only
  // tag either module ever touches here.
  function tagStore(idField) {
    const rows = new Map(); // ownerId -> { id, [idField]: ownerId, tagId, quantity }
    let seq = 0;
    for (const [ownerId, quantity] of bal) {
      if (quantity > 0) rows.set(ownerId, { id: `${idField}${++seq}`, [idField]: ownerId, tagId: RESOURCES_TAG_ID, quantity });
    }
    return {
      async findUnique({ where }) {
        const key = where[`${idField}_tagId`];
        if (!key) return null;
        const row = rows.get(key[idField]);
        if (!row || row.tagId !== key.tagId) return null;
        return { id: row.id, quantity: row.quantity };
      },
      async create({ data }) {
        const row = { id: `${idField}${++seq}`, [idField]: data[idField], tagId: data.tagId, quantity: data.quantity };
        rows.set(data[idField], row);
        bal.set(data[idField], row.quantity);
        return row;
      },
      async update({ where, data }) {
        const row = [...rows.values()].find((r) => r.id === where.id);
        if (!row) throw new Error("no such row");
        if (typeof data.quantity === "object" && data.quantity.increment != null) row.quantity += data.quantity.increment;
        else row.quantity = data.quantity;
        bal.set(row[idField], row.quantity);
        return row;
      },
      async updateMany({ where, data }) {
        const ownerId = where[idField];
        const row = rows.get(ownerId);
        if (!row || row.tagId !== where.tagId) return { count: 0 };
        const need = where.quantity?.gte ?? 0;
        if (row.quantity < need) return { count: 0 };
        row.quantity -= data.quantity.decrement ?? 0;
        bal.set(ownerId, row.quantity);
        return { count: 1 };
      },
      async delete({ where }) {
        const row = [...rows.values()].find((r) => r.id === where.id);
        if (row) {
          rows.delete(row[idField]);
          bal.set(row[idField], 0);
        }
      },
      async deleteMany({ where }) {
        const ownerId = where[idField];
        const row = rows.get(ownerId);
        if (row && row.quantity <= (where.quantity?.lte ?? 0)) {
          rows.delete(ownerId);
          bal.set(ownerId, 0);
        }
      },
    };
  }

  const entries = [];
  const sql = [];
  const lookups = { count: 0 };
  return {
    bal,
    entries,
    sql,
    lookups,
    // Always resolves the one `resources` tag — resourceStack.js caches this
    // id at module scope, so the exact id string only has to be stable, not
    // fresh per transaction.
    tag: { async findUnique() { return { id: RESOURCES_TAG_ID }; } },
    characterTag: tagStore("characterId"),
    roomTag: tagStore("roomId"),
    // findUnique, because the ledger reads the singleton through
    // db/lib/gameState.js#readGameState like every other module does.
    gameState: {
      async findUnique() {
        lookups.count += 1;
        return { gameId: "g1" };
      },
    },
    economyEntry: { async create({ data }) { entries.push(data); return data; } },
    async $executeRawUnsafe(text) { sql.push(text); },
  };
}

// The ledger's sum for one account, counting a leg out as negative.
function ledgerBalance(entries, kind, id) {
  let n = 0;
  for (const e of entries) {
    if (e.fromKind === kind && e.fromId === id) n -= e.amount;
    if (e.toKind === kind && e.toId === id) n += e.amount;
  }
  return n;
}

const ada = { kind: "character", id: "ada", name: "Ada" };
const bram = { kind: "character", id: "bram", name: "Bram" };
const stash = { kind: "room", id: "stash", name: "The stash" };

test("amount is always positive; a signed amount swaps the legs", async () => {
  const tx = fakeTx();
  await record(tx, { from: ada, to: bram, form: "BALANCE", amount: -5 });
  assert.equal(tx.entries.length, 1);
  const e = tx.entries[0];
  assert.equal(e.amount, 5);
  assert.equal(e.fromId, "bram");
  assert.equal(e.toId, "ada");
});

test("a zero move writes nothing, and a row with no ends at all writes nothing", async () => {
  const tx = fakeTx();
  await record(tx, { from: ada, to: bram, form: "BALANCE", amount: 0 });
  await record(tx, { from: null, to: null, form: "BALANCE", amount: 9 });
  assert.equal(tx.entries.length, 0);
});

test("a write with no reason is recorded as UNATTRIBUTED, never dropped", async () => {
  const tx = fakeTx();
  await recordDelta(tx, ada, 7);
  assert.equal(tx.entries.length, 1);
  assert.equal(tx.entries[0].reason, "UNATTRIBUTED");
  assert.equal(tx.entries[0].fromKind, "world");
  assert.equal(tx.entries[0].fromId, "mint");
});

test("a ledger failure never fails the money move", async () => {
  const tx = fakeTx({ ada: 10 });
  tx.economyEntry.create = async () => {
    throw new Error("ledger is on fire");
  };
  await moveParty(tx, ada, -4);
  assert.equal(tx.bal.get("ada"), 6, "the balance still moved");
});

test("a failed ledger write is rolled back to a SAVEPOINT, not merely caught", async () => {
  // The reason this test exists: Postgres aborts the WHOLE transaction on a
  // failed statement and refuses every statement after it with 25P02, so
  // catching the error in JavaScript does not un-abort anything — the money
  // move would go down with the ledger row. Only a savepoint makes the failure
  // recoverable, and an earlier version of this file could not tell the
  // difference because its fake transaction never threw.
  const tx = fakeTx({ ada: 10 });
  tx.economyEntry.create = async () => {
    throw new Error("ledger is on fire");
  };
  await moveParty(tx, ada, -4);
  assert.deepEqual(tx.sql, ["SAVEPOINT economy_entry", "ROLLBACK TO SAVEPOINT economy_entry"]);
});

test("a successful ledger write releases its savepoint", async () => {
  const tx = fakeTx({ ada: 10 });
  await moveParty(tx, ada, -4, { reason: "HUNGER" });
  assert.deepEqual(tx.sql, ["SAVEPOINT economy_entry", "RELEASE SAVEPOINT economy_entry"]);
});

test("an amount past int4 is clamped rather than raising", async () => {
  // The realistic overflow: a big stack of a high-priced tag multiplied out.
  // A wrong-but-huge number on a report is a bug to find; a lost purchase is
  // somebody's afternoon.
  const tx = fakeTx();
  await record(tx, { from: ada, to: bram, form: "GOODS", amount: 9e18 });
  assert.equal(tx.entries.length, 1);
  assert.equal(tx.entries[0].amount, 2147483647);
});

test("moveParty reconciles: ledger sum equals the live balance", async () => {
  const tx = fakeTx({ ada: 0 });
  await moveParty(tx, ada, 10, { reason: "MINING" });
  await moveParty(tx, ada, -3, { reason: "HUNGER" });
  await moveParty(tx, ada, 5, { reason: "MINING_DROP" });
  assert.equal(tx.bal.get("ada"), 12);
  assert.equal(ledgerBalance(tx.entries, "character", "ada"), 12);
});

test("a refused debit moves nothing and records nothing", async () => {
  const tx = fakeTx({ ada: 2 });
  await assert.rejects(() => moveParty(tx, ada, -5, { reason: "HUNGER" }), InsufficientResourcesError);
  assert.equal(tx.bal.get("ada"), 2);
  assert.equal(tx.entries.length, 0);
});

test("a transfer is ONE row, not two, and both ends still reconcile", async () => {
  const tx = fakeTx({ ada: 20, bram: 0 });
  await applyTransfer(tx, { from: ada, to: bram, amount: 8 }, { reason: "TRANSFER" });
  assert.equal(tx.entries.length, 1, "one movement, one row");
  assert.equal(tx.bal.get("ada"), 12);
  assert.equal(tx.bal.get("bram"), 8);
  assert.equal(ledgerBalance(tx.entries, "character", "ada"), -8);
  assert.equal(ledgerBalance(tx.entries, "character", "bram"), 8);
});

test("an unnamed transfer is UNATTRIBUTED, not quietly labelled TRANSFER", async () => {
  // It used to default to "TRANSFER", which made every un-hooked transfer site
  // look deliberate and kept the four biggest of them off the panel's own
  // un-hooked-call-sites list. An unnamed transfer is meant to look wrong.
  const tx = fakeTx({ ada: 20, bram: 0 });
  await applyTransfer(tx, { from: ada, to: bram, amount: 1 });
  assert.equal(tx.entries[0].reason, "UNATTRIBUTED");
  const tx2 = fakeTx({ ada: 20, bram: 0 });
  await applyTransfer(tx2, { from: ada, to: bram, amount: 1 }, { reason: "TAX" });
  assert.equal(tx2.entries[0].reason, "TAX");
});

test("a failed second leg records nothing at all", async () => {
  // bram cannot pay, so the transfer must leave no row behind claiming it did.
  const tx = fakeTx({ ada: 0, bram: 1 });
  await assert.rejects(() => applyTransfer(tx, { from: bram, to: ada, amount: 50 }, { reason: "TRANSFER" }));
  assert.equal(tx.entries.length, 0);
});

test("the Spillway burns what arrives, and the room still reconciles at zero", async () => {
  // Room.destroysContents — the Godard Factory's Spillway. The balance does not
  // move, so the book has to show the ⬢ arriving AND being destroyed, or the
  // reconciliation check reads a drift that isn't there.
  const spillway = { kind: "room", id: "spillway", name: "The Spillway", destroysContents: true };
  const tx = fakeTx({ spillway: 0 });
  await moveParty(tx, spillway, 12, { reason: "STASH" });
  assert.equal(tx.bal.get("spillway"), 0, "nothing was actually added");
  assert.equal(ledgerBalance(tx.entries, "room", "spillway"), 0, "and the book agrees");
  assert.ok(
    tx.entries.some((e) => e.reason === "SPILLWAY" && e.toKind === "world" && e.toId === "burn"),
    "the destruction is on the record",
  );
});

test("a transfer into the Spillway does not double-count the sender", async () => {
  const spillway = { kind: "room", id: "spillway", name: "The Spillway", destroysContents: true };
  const tx = fakeTx({ ada: 30, spillway: 0 });
  await applyTransfer(tx, { from: ada, to: spillway, amount: 30 }, { reason: "STASH" });
  assert.equal(tx.bal.get("ada"), 0);
  assert.equal(tx.bal.get("spillway"), 0);
  assert.equal(ledgerBalance(tx.entries, "character", "ada"), -30, "charged once, not twice");
  assert.equal(ledgerBalance(tx.entries, "room", "spillway"), 0);
});

test("a party kind the table does not know is a no-op in the book too", async () => {
  // "silo" was a party kind until 9/2026 and dormant rows still carry it.
  // moveParty ignores a kind it does not know; the ledger must not invent a
  // row for money that never moved.
  const tx = fakeTx();
  await moveParty(tx, { kind: "silo", id: "s1", name: "A silo" }, 40, { reason: "TRANSFER" });
  assert.equal(tx.entries.length, 0);
});

test("a whole turn of mixed traffic reconciles across every account", async () => {
  const tx = fakeTx({ ada: 0, bram: 0, stash: 0 });
  await moveParty(tx, ada, 14, { reason: "MINING" });
  await moveParty(tx, bram, 9, { reason: "MINING" });
  await applyTransfer(tx, { from: ada, to: bram, amount: 4 }, { reason: "TRANSFER" });
  await applyTransfer(tx, { from: bram, to: stash, amount: 10 }, { reason: "STASH" });
  await moveParty(tx, ada, -1, { reason: "HUNGER" });
  await moveParty(tx, bram, -1, { reason: "HUNGER" });

  for (const [kind, id] of [["character", "ada"], ["character", "bram"], ["room", "stash"]]) {
    assert.equal(ledgerBalance(tx.entries, kind, id), tx.bal.get(id), `${id} reconciles`);
  }
  // And the supply only moved by what was minted and burned.
  const minted = tx.entries.filter((e) => e.fromId === "mint").reduce((n, e) => n + e.amount, 0);
  const burned = tx.entries.filter((e) => e.toId === "burn").reduce((n, e) => n + e.amount, 0);
  const live = [...tx.bal.values()].reduce((n, v) => n + v, 0);
  assert.equal(live, minted - burned, "supply equals mints minus burns");
});

test("the game is looked up once per transaction, not once per row", async () => {
  // A turn-end pass books a row for every one of 100+ characters. One lookup
  // apiece put 100+ extra round-trips inside the most fragile pass in the game.
  const tx = fakeTx({ ada: 100 });
  for (let i = 0; i < 10; i++) await moveParty(tx, ada, -1, { reason: "HUNGER" });
  assert.equal(tx.entries.length, 10);
  assert.equal(tx.lookups.count, 1);
});

test("a row is stamped with the zone of whichever end is a real place", async () => {
  // db/lib/parties.js already selects zoneId onto every party it resolves.
  // Without this the column was always null and the GM zone filter matched
  // everything for everybody.
  const tx = fakeTx({ ada: 10 });
  const inTown = { kind: "character", id: "ada", name: "Ada", zoneId: "town" };
  await moveParty(tx, inTown, -3, { reason: "HUNGER" });
  assert.equal(tx.entries[0].zoneId, "town");
});

test("an explicit zone in the context still wins over the party's", async () => {
  const tx = fakeTx({ ada: 10 });
  const inTown = { kind: "character", id: "ada", name: "Ada", zoneId: "town" };
  await moveParty(tx, inTown, -3, { reason: "HUNGER", zoneId: "caves" });
  assert.equal(tx.entries[0].zoneId, "caves");
});
