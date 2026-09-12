// Moves ⬢ between two parties (see db/lib/parties.js) atomically, never
// minting or burning a balance from nowhere. Shared by the turn-end push and
// every GM transfer surface.
//
// Prisma runs READ COMMITTED, so the balance check must be the write itself
// (a conditional updateMany matching only while the balance still covers the
// amount), not a separate read-then-decrement, or two concurrent requests can
// both pass and both subtract. Every caller runs inside a $transaction.
const { record, recordDelta, BURN } = require("./economyLedger");

class InsufficientResourcesError extends Error {
  constructor(party, amount) {
    super(`${party?.name ?? "That party"} no longer has ${amount} ⬢.`);
    this.party = party;
    this.amount = amount;
  }
}

// Which model and column hold each party kind's balance. A table rather
// than a branch so applyTransfer's (kind, id) lock ordering keeps working
// unchanged as kinds are added. (A faction Silo was the second kind until
// 9/2026 — old TRANSFER_RESOURCES rows may still name one; moveParty ignores
// a kind it doesn't know, so their Undo is a no-op on that end.)
const BALANCE = {
  character: ["character", "resources"],
  room: ["room", "resources"],
};

async function moveParty(tx, party, delta, ctx) {
  if (!party || !delta) return;
  const spec = BALANCE[party.kind];
  if (!spec) return;

  // A room that eats what is put into it (Room.destroysContents — the Godard
  // Factory's Spillway). Money going IN goes nowhere; money coming OUT is
  // still allowed, because Undo has to be able to take back what it drained
  // from the sender and nothing was ever added here to overdraw.
  if (party.destroysContents && delta > 0) {
    // The money that came in is destroyed, not merely un-added. Before the
    // ledger this simply vanished with no trace anywhere in the game.
    //
    // TWO rows, because the reconciliation check on /gm/economy compares each
    // account's ledger sum against its live balance, and one row would break
    // it. The room's balance does not move here, so the book has to show the
    // ⬢ both arriving and being destroyed:
    //
    //   - the arrival, under the same suppression rule as the normal path.
    //     applyTransfer writes its own single sender -> room row, so the leg
    //     is suppressed there and written here only for a bare moveParty.
    //   - the burn, always, because the destruction is real either way and is
    //     the whole reason anyone would look at the Spillway on the panel.
    //
    // Net across the two: zero, which is exactly what the room's balance did.
    if (!ctx?.__suppress) await recordDelta(tx, party, delta, ctx);
    await record(tx, { from: party, to: BURN, form: "BALANCE", amount: delta }, { ...ctx, reason: "SPILLWAY", __suppress: undefined });
    return;
  }

  const [modelName, field] = spec;
  const model = tx[modelName];

  if (delta > 0) {
    await model.update({ where: { id: party.id }, data: { [field]: { increment: delta } } });
    if (!ctx?.__suppress) await recordDelta(tx, party, delta, ctx);
    return;
  }

  const amount = -delta;
  const { count } = await model.updateMany({
    where: { id: party.id, [field]: { gte: amount } },
    data: { [field]: { decrement: amount } },
  });
  if (count) {
    if (!ctx?.__suppress) await recordDelta(tx, party, delta, ctx);
    return;
  }

  throw new InsufficientResourcesError(party, amount);
}

// Moves `amount` from `from` to `to`. Legs are sorted by (kind, id), not by
// sender, so a total order over participants avoids a lock-order deadlock
// between concurrent transfers. `ledger` is accepted and ignored: it fed the
// Silo rows, and callers still pass it.
//
// A transfer is ONE ledger row, not two: each leg's own moveParty call would
// otherwise write its own entry, double-booking the same movement from both
// ends. `ctx.__suppress` tells moveParty to skip its per-leg row so this can
// write the single combined one once both legs have actually succeeded — if
// the second leg throws (InsufficientResourcesError), nothing is recorded at
// all, matching the fact that nothing was actually moved.
async function applyTransfer(tx, { from, to, amount }, ctx) {
  const legs = [
    [from, -amount],
    [to, amount],
  ].sort(([a], [b]) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));

  const legCtx = ctx ? { ...ctx, __suppress: true } : { __suppress: true };
  for (const [party, delta] of legs) {
    await moveParty(tx, party, delta, legCtx);
  }

  const recordCtx = ctx?.reason ? ctx : { ...ctx, reason: "TRANSFER" };
  await record(tx, { from, to, form: "BALANCE", amount }, recordCtx);
}

module.exports = { moveParty, applyTransfer, InsufficientResourcesError };
