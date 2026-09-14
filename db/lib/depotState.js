const { record, MINT, BURN, DEPOT_ACCOUNT } = require("./economyLedger");

// The Depot singleton's live state: the account, the generator, the shuttle.
//
// Every mover here clamps inside ONE locked statement rather than a read-modify-write, like
// db/lib/lifeweb.js#bumpBlood — two people spending from the same account at once must not be able to
// stomp each other, and the returned `delta` is what actually moved, which Undo reads off Request.effect (REQUESTS.md §2).
// Takes `tx` as a parameter rather than requiring db/index.js back (db/lib/dm.js convention).

// The tag that opens the landing pad and cracks a sealed crate. NOT what the turret reads (depotTurret.js).
const DEPOT_KEYCARD_SLUG = "depot-keycard";

// The two things the generator will burn, best first.
const COAL_SLUG = "coal";
const SALTPETER_SLUG = "saltpeter";

// The currency.
const OBOL_SLUG = "obol";

// The room the shuttle lands in. A room's id is always `<location-stem>-<room>` (docs/zones.yaml), so
// this must follow whichever Location the pad sits in — getting this wrong reports every shuttle
// action as "a GM needs to run the zone sync".
const LANDING_PAD_SLUG = "depot-landing-pad";

// Nothing at the Depot works with the generator off. One predicate so the web actions, turn passes and
// Examine line can't drift on what "off" means — fuel at zero is off even if the switch says otherwise.
function depotPowered(depot) {
  return Boolean(depot?.generatorOn) && (depot?.generatorFuel ?? 0) > 0;
}

// How many whole turns of running is left in the tank. What the cockpit gauge
// and the Examine line both report, so they cannot disagree.
function fuelTurnsLeft(depot) {
  const burn = depot?.fuelBurnPerTurn ?? 0;
  if (burn <= 0) return null;
  return Math.floor((depot?.generatorFuel ?? 0) / burn);
}

// How much room is left on the credit line. Clamped at BOTH ends — the upper clamp is load-bearing:
// a debt driven below zero by an Undo after repayment would otherwise read as more headroom than the cap allows.
function creditAvailableObols(depot) {
  const cap = depot?.creditCapObols ?? 0;
  return Math.min(cap, Math.max(0, cap - (depot?.debtObols ?? 0)));
}

// The Depot row, created on first touch. Every reader goes through this so a
// fresh database never hands back null.
async function loadDepot(tx) {
  return tx.depot.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Who the turret spares. Written on Merchant creation (web/app/(app)/character/createActions.js),
// writable by a GM from /gm/dev after. Set ONCE, never follows the character — a Merchant who conceals
// himself presents an alias, misses this string and is shot by his own gun, which is the point.
// A blank name is ignored rather than stored.
async function setMerchantFace(tx, name) {
  const face = String(name ?? "").trim();
  if (!face) return null;
  await loadDepot(tx);
  return tx.depot.update({ where: { id: 1 }, data: { merchantFace: face } });
}

// The shared shape behind every mover below: lock the row, clamp inside the UPDATE, report what
// actually moved. `column` is interpolated as an identifier and so must never come from user input.
async function bumpColumn(tx, column, amount, { max = null } = {}) {
  await loadDepot(tx);

  if (!amount) {
    const depot = await tx.depot.findUnique({ where: { id: 1 } });
    const current = depot?.[column] ?? 0;
    return { before: current, after: current, delta: 0 };
  }

  // Prisma tags every ${} in $queryRaw as a bound parameter, wrong for a column name — an identifier
  // cannot be a parameter. $queryRawUnsafe with the numbers still bound keeps the injection surface at zero.
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

// Obols into or out of the station's account. No ceiling. `ctx` is optional and, when passed, records
// the move on the economy ledger (form ACCOUNT). Default ends are MINT (deposit) / BURN (withdrawal);
// `ctx.econ` overrides `from`/`to` when a caller knows the real counterparty. No `ctx` records nothing.
async function bumpAccount(tx, amount, ctx) {
  const result = await bumpColumn(tx, "accountObols", amount);
  if (ctx && result.delta) {
    // record() never throws (economyLedger.js rule 2) — a ledger hiccup logs and drops the row.
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

// Fuel, capped at the tank's size so shovelling coal into a full generator
// wastes it rather than banking it.
async function bumpFuel(tx, amount) {
  const depot = await loadDepot(tx);
  return bumpColumn(tx, "generatorFuel", amount, { max: depot.fuelMax ?? 100 });
}

// There is no ⬢-to-obol conversion, on purpose. One obol IS one ⬢. The catalog's depotPrice/sellablePrice
// stay denominated in ⬢, meaning the same number whether the Merchant is buying or a player is
// pricing in conversation. At parity every catalog price is already a whole number of obols, so
// nothing rounds and there is no margin for rounding to hide in.

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
