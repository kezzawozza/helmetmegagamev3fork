// Moves ⬢ between two parties (see db/lib/parties.js) atomically, never
// minting or burning a balance from nowhere. Shared by the turn-end push and
// every GM transfer surface.
//
// Prisma runs READ COMMITTED, so the balance check must be the write itself
// (a conditional updateMany), not a separate read-then-decrement, or two
// concurrent requests can both pass and both subtract.
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
// unchanged as kinds are added.
const BALANCE = {
  character: ["character", "resources"],
  room: ["room", "resources"],
};

async function moveParty(tx, party, delta, ctx) {
  if (!party || !delta) return;
  const spec = BALANCE[party.kind];
  if (!spec) return;

  // A room that eats what is put into it (Room.destroysContents — the
  // Spillway). Money going IN is destroyed; money coming OUT is still
  // allowed so Undo can take back what it drained from the sender.
  if (party.destroysContents && delta > 0) {
    // TWO rows: reconciliation on /gm/economy compares each account's ledger
    // sum against its live balance, and the room's balance doesn't move here,
    // so the book must show the ⬢ both arriving (suppressed the normal way)
    // and being destroyed (always). Net across the two: zero.
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
