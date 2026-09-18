const { record, DEPOT_DEBT } = require("./economyLedger");

// The Depot singleton's live state: the credit line, the turret, the sell-tax
// rate. Every mover clamps inside ONE locked statement, not a read-modify-write
// (like db/lib/lifeweb.js#bumpBlood), so two spenders can't stomp each other.
// Takes `tx` as a parameter rather than requiring db/index.js back (db/lib/dm.js convention).
//
// The generator, the shuttle and the station's own float all used to live here.
// The float is the Merchant's BankAccount now (db/lib/bankAccounts.js), and the
// other two went with the train (db/lib/train.js).

// The tag that opens the Railyard and cracks a sealed crate. NOT what the turret reads (depotTurret.js).
const DEPOT_KEYCARD_SLUG = "depot-keycard";

// The currency.
const OBOL_SLUG = "obol";

// Clamped at BOTH ends: the upper clamp is load-bearing, or a debt driven
// below zero by an Undo would read as more headroom than the cap allows.
function creditAvailableObols(depot) {
  const cap = depot?.creditCapObols ?? 0;
  return Math.min(cap, Math.max(0, cap - (depot?.debtObols ?? 0)));
}

// Created on first touch, so a fresh database never hands back null.
async function loadDepot(tx) {
  return tx.depot.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Who the turret spares. Set ONCE, never follows the character — a Merchant
// who conceals himself misses this string and is shot by his own gun, on
// purpose. Blank name is ignored, not stored.
async function setMerchantFace(tx, name) {
  const face = String(name ?? "").trim();
  if (!face) return null;
  await loadDepot(tx);
  return tx.depot.update({ where: { id: 1 }, data: { merchantFace: face } });
}

// Lock the row, clamp inside the UPDATE, report what moved. `column` is interpolated as an
// identifier — must never come from user input.
async function bumpColumn(tx, column, amount, { max = null } = {}) {
  await loadDepot(tx);

  if (!amount) {
    const depot = await tx.depot.findUnique({ where: { id: 1 } });
    const current = depot?.[column] ?? 0;
    return { before: current, after: current, delta: 0 };
  }

  // $queryRaw binds every ${}, wrong for a column name; $queryRawUnsafe with the numbers still
  // bound keeps the injection surface at zero.
  const ceiling = max === null ? "NULL" : "$2::int";
  const params = max === null ? [amount] : [amount, max];
  const rows = await tx.$queryRawUnsafe(
    `
    WITH prev AS (
      SELECT "${column}" AS before FROM "Depot" WHERE "id" = 1 FOR UPDATE
    )
    UPDATE "Depot" d
    SET "${column}" = GREATEST(0, LEAST(COALESCE(${ceiling}, prev.before + $1::int), prev.before + $1::int))
    FROM prev
    WHERE d."id" = 1
    RETURNING prev.before AS before, d."${column}" AS after
    `,
    ...params,
  );

  const before = rows[0]?.before ?? 0;
  const after = rows[0]?.after ?? before;
  return { before, after, delta: after - before };
}

// The Company's line. No ceiling here — the CAP is refused rather than clamped
// by the caller, so the Merchant is told he hit it. `ctx`, when passed, records
// the move on the ledger (form DEBT). No `ctx` records nothing.
async function bumpDebt(tx, amount, ctx) {
  const result = await bumpColumn(tx, "debtObols", amount);
  if (ctx && result.delta) {
    // record() never throws (economyLedger.js rule 2) — a hiccup logs and drops the row.
    const econ = ctx.econ ?? {};
    await record(
      tx,
      {
        from: econ.from ?? (result.delta > 0 ? DEPOT_DEBT : econ.other ?? null),
        to: econ.to ?? (result.delta > 0 ? econ.other ?? null : DEPOT_DEBT),
        form: "DEBT",
        amount: Math.abs(result.delta),
      },
      econ,
    );
  }
  return result;
}

// No ⬢-to-obol conversion, on purpose: one obol IS one ⬢, so catalog prices are already whole
// obols and nothing rounds.

module.exports = {
  DEPOT_KEYCARD_SLUG,
  OBOL_SLUG,
  creditAvailableObols,
  loadDepot,
  setMerchantFace,
  bumpColumn,
  bumpDebt,
};
