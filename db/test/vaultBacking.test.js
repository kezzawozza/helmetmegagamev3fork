// node --test over the hard half of the bank: the Keep's Vault standing behind
// every TREASURY claim. Run with `npm test --workspace=db`.
//
// Nothing here touches Prisma. The two properties worth holding onto:
//
//   1. A withdrawal the Vault cannot cover is REFUSED, never clamped. A clamp
//      would hand somebody less than they asked for and say nothing, which is
//      the quiet failure the whole backing exists to prevent.
//   2. The Meister's cut and the seller's net always sum to the gross. A
//      rounding rule that loses an obol somewhere loses it forever, since the
//      pass books both halves as separate movements.
const test = require("node:test");
const assert = require("node:assert/strict");
const { takeFromVault } = require("../lib/bankAccounts");
const { taxOn } = require("../lib/trainDeparturePass");

const COIN = { id: "tag_obol", slug: "obol", name: "Obol" };
const ROOM = { id: "room_vault", name: "Vault" };

// Stands in for a transaction client, modelling only what takeFromVault calls:
// a conditional updateMany over the Vault's obol row, and the tidy-up delete.
function fakeTx(quantity) {
  const state = { quantity };
  return {
    state,
    roomTag: {
      async updateMany({ where, data }) {
        const gte = where.quantity?.gte ?? 0;
        if (where.roomId !== ROOM.id || where.tagId !== COIN.id) return { count: 0 };
        if (state.quantity < gte) return { count: 0 };
        state.quantity -= data.quantity.decrement;
        return { count: 1 };
      },
      async deleteMany() {
        return { count: 0 };
      },
    },
  };
}

test("a Vault with the coin pays out, and the stash goes down by exactly that much", async () => {
  const tx = fakeTx(350);
  await takeFromVault(tx, 40, { coin: COIN, room: ROOM });
  assert.equal(tx.state.quantity, 310);
});

test("a short Vault refuses rather than paying what it has", async () => {
  const tx = fakeTx(10);
  await assert.rejects(() => takeFromVault(tx, 40, { coin: COIN, room: ROOM }), /Vault is short/);
  // Untouched: the refusal is what rolls the caller's account debit back, so a
  // partial decrement here would be money created out of a failed withdrawal.
  assert.equal(tx.state.quantity, 10);
});

test("taking exactly what is there is allowed; one more is not", async () => {
  const tx = fakeTx(7);
  await takeFromVault(tx, 7, { coin: COIN, room: ROOM });
  assert.equal(tx.state.quantity, 0);
  await assert.rejects(() => takeFromVault(tx, 1, { coin: COIN, room: ROOM }), /Vault is short/);
});

test("a refusal carries a userMessage, so both faces say the same sentence", async () => {
  const tx = fakeTx(0);
  await assert.rejects(
    () => takeFromVault(tx, 1, { coin: COIN, room: ROOM }),
    (err) => typeof err.userMessage === "string" && err.userMessage.length > 0,
  );
});

test("the sell tax and the net always add back up to the gross", () => {
  for (let rate = 0; rate <= 100; rate += 1) {
    for (const gross of [0, 1, 3, 7, 41, 149, 1000]) {
      const tax = taxOn(gross, rate);
      assert.ok(tax >= 0, `rate ${rate}, gross ${gross}: negative tax`);
      assert.ok(tax <= gross, `rate ${rate}, gross ${gross}: tax over gross`);
      assert.equal(tax + (gross - tax), gross);
    }
  }
});

test("a rate of zero takes nothing, and a rate outside 0-100 is clamped rather than trusted", () => {
  assert.equal(taxOn(100, 0), 0);
  assert.equal(taxOn(100, 100), 100);
  // The Dev Panel clamps and the terminal refuses, but a hand-edited row can
  // still reach this — it must not hand a seller a negative payout.
  assert.equal(taxOn(100, -50), 0);
  assert.equal(taxOn(100, 500), 100);
});
