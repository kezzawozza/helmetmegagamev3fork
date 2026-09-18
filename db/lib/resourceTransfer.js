// Moves ⬢ between two parties (see db/lib/parties.js) atomically, never
// minting or burning a balance from nowhere. Shared by the turn-end push and
// every GM transfer surface.
//
// Prisma runs READ COMMITTED, so the balance check must be the write itself
// (a conditional updateMany), not a separate read-then-decrement, or two
// concurrent requests can both pass and both subtract. That check lives in
// db/lib/resourceStack.js#takeCharacterResources now, against the stack row
// that replaced the Character.resources column in 9/2026 — same shape, one
// table over.
const { record, recordDelta, BURN } = require("./economyLedger");
const {
  addCharacterResources,
  addRoomResources,
  takeCharacterResources,
  takeRoomResources,
} = require("./resourceStack");

class InsufficientResourcesError extends Error {
  constructor(party, amount) {
    super(`${party?.name ?? "That party"} no longer has ${amount} ⬢.`);
    this.party = party;
    this.amount = amount;
  }
}

// How each party kind's ⬢ are added to and taken from. A table rather than a
// branch so applyTransfer's (kind, id) lock ordering keeps working unchanged as
// kinds are added.
//
// These used to be a model name and a column name — ["character", "resources"]
// — read straight into a Prisma update. There is no such column since ⬢ became
// a one-pound item, so each kind names its pair of stack writers from
// db/lib/resourceStack.js instead. `take` is the STRICT one: it takes the whole
// amount or reports that it could not, which is what the overdraw throw below
// needs.
const BALANCE = {
  character: { add: addCharacterResources, take: takeCharacterResources },
  room: { add: addRoomResources, take: takeRoomResources },
};

async function moveParty(tx, party, delta, ctx) {
  if (!party || !delta) return;
  const spec = BALANCE[party.kind];
  if (!spec) return;

  // A room that eats what is put into it (Room.destroysContents — the
  // Spillway). Money going IN is destroyed; money coming OUT is still
  // allowed so Undo can take back what it drained from the sender.
  if (party.destroysContents && delta > 0) {
    // TWO rows: reconciliation compares each account's ledger sum against its
    // live balance, and the room's balance doesn't move here,
    // so the book must show the ⬢ both arriving (suppressed the normal way)
    // and being destroyed (always). Net across the two: zero.
    if (!ctx?.__suppress) await recordDelta(tx, party, delta, ctx);
    await record(tx, { from: party, to: BURN, form: "BALANCE", amount: delta }, { ...ctx, reason: "SPILLWAY", __suppress: undefined });
    return;
  }

  if (delta > 0) {
    await spec.add(tx, party.id, delta);
    if (!ctx?.__suppress) await recordDelta(tx, party, delta, ctx);
    return;
  }

  const amount = -delta;
  if (await spec.take(tx, party.id, amount)) {
    if (!ctx?.__suppress) await recordDelta(tx, party, delta, ctx);
    return;
  }

  throw new InsufficientResourcesError(party, amount);
}

// Moves `amount` from `from` to `to`. Legs sorted by (kind, id), not sender,
// so a total order over participants avoids a lock-order deadlock.
//
// A transfer is ONE ledger row, not two: each leg's own moveParty call would
// otherwise double-book the same movement from both ends.
// `ctx.__suppress` tells moveParty to skip its per-leg row so this writes the
// single combined one once both legs succeed — if the second leg throws,
// nothing is recorded, matching the fact nothing actually moved.
async function applyTransfer(tx, { from, to, amount }, ctx) {
  const legs = [
    [from, -amount],
    [to, amount],
  ].sort(([a], [b]) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));

  const legCtx = ctx ? { ...ctx, __suppress: true } : { __suppress: true };
  for (const [party, delta] of legs) {
    await moveParty(tx, party, delta, legCtx);
  }

  // NO default reason: an unnamed transfer reads UNATTRIBUTED like every
  // other hook, and is meant to look wrong.
  await record(tx, { from, to, form: "BALANCE", amount }, ctx);
}

module.exports = { moveParty, applyTransfer, InsufficientResourcesError };
