const { record, MINT, BURN, DEPOT_ACCOUNT } = require("./economyLedger");

// The Depot singleton's live state: account, generator, shuttle. Every mover
// clamps inside ONE locked statement, not a read-modify-write (like
// db/lib/lifeweb.js#bumpBlood), so two spenders can't stomp each other; the
// returned `delta` is what Undo reads off Request.effect (REQUESTS.md §2).
// Takes `tx` as a parameter rather than requiring db/index.js back (db/lib/dm.js convention).

// The tag that opens the landing pad and cracks a sealed crate. NOT what the turret reads (depotTurret.js).
const DEPOT_KEYCARD_SLUG = "depot-keycard";

// The two things the generator will burn, best first.
const COAL_SLUG = "coal";
const SALTPETER_SLUG = "saltpeter";

// The currency.
const OBOL_SLUG = "obol";

// Room id is always `<location-stem>-<room>` (docs/zones.yaml); must follow whichever Location the
// pad sits in, or every shuttle action reports "a GM needs to run the zone sync".
const LANDING_PAD_SLUG = "depot-landing-pad";

// One predicate so web actions, turn passes and Examine can't drift on "off" — fuel at zero is off
// even if the switch says otherwise.
function depotPowered(depot) {
  return Boolean(depot?.generatorOn) && (depot?.generatorFuel ?? 0) > 0;
}

// What the cockpit gauge and Examine line both report, so they cannot disagree.
function fuelTurnsLeft(depot) {
  const burn = depot?.fuelBurnPerTurn ?? 0;
  if (burn <= 0) return null;
  return Math.floor((depot?.generatorFuel ?? 0) / burn);
}

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

// No ceiling. `ctx`, when passed, records the move on the economy ledger (form ACCOUNT); default
// ends are MINT (deposit)/BURN (withdrawal), overridable via `ctx.econ`. No `ctx` records nothing.
async function bumpAccount(tx, amount, ctx) {
  const result = await bumpColumn(tx, "accountObols", amount);
  if (ctx && result.delta) {
    // record() never throws (economyLedger.js rule 2) — a hiccup logs and drops the row.
    const econ = ctx.econ ?? {};
    const defaultFrom = result.delta > 0 ? MINT : DEPOT_ACCOUNT;
    const defaultTo = result.delta > 0 ? DEPOT_ACCOUNT : BURN;
    await record(
      tx,
      {
        from: econ.from ?? defaultFrom,
        to: econ.to ?? defaultTo,
        form: "ACCOUNT",
        amount: Math.abs(result.delta),
      },
      econ,
    );
  }
  return result;
}

// Capped at the tank's size so shovelling coal into a full generator wastes it rather than banking it.
async function bumpFuel(tx, amount) {
  const depot = await loadDepot(tx);
  return bumpColumn(tx, "generatorFuel", amount, { max: depot.fuelMax ?? 100 });
}

// No ⬢-to-obol conversion, on purpose: one obol IS one ⬢, so catalog prices are already whole
// obols and nothing rounds.

module.exports = {
  DEPOT_KEYCARD_SLUG,
  COAL_SLUG,
  SALTPETER_SLUG,
  OBOL_SLUG,
  LANDING_PAD_SLUG,
  depotPowered,
  fuelTurnsLeft,
  creditAvailableObols,
  loadDepot,
  setMerchantFace,
  bumpAccount,
  bumpFuel,
};
