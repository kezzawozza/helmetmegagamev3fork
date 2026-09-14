// Written INSIDE the caller's transaction (`tx`, db/lib/dm.js convention) so
// a row never outlives a rollback. Invariants: `amount` always POSITIVE, from
// -> to; a ledger failure NEVER fails the money move (SAVEPOINT/ROLLBACK, not
// try/catch — Postgres aborts on 25P02, JS catch cannot un-abort); a reasonless write is UNATTRIBUTED, never dropped.
const { DEFAULT_REASON } = require("./economyReasons");
const { readGameState } = require("./gameState");

// Book accounts so every entry has two ends; MINT/BURN named rather than a null end, so "where did 400 ⬢ come from" is answerable.
const MINT = { kind: "world", id: "mint", name: "Minted" };
const BURN = { kind: "world", id: "burn", name: "Burned" };
const COMPANY = { kind: "offworld", id: "company", name: "The Company" };
// Separate accounts: the station's float and the Merchant's purse are NOT the same money (DEPOT.md §0g); summing them would lie on the panel's front page.
const DEPOT_ACCOUNT = { kind: "depot", id: "account", name: "Depot account" };
const DEPOT_DEBT = { kind: "depot", id: "debt", name: "The Company's line" };

const MAX_INT4 = 2147483647;

// Fences `fn` with a SAVEPOINT so a failure can't poison the caller's transaction; falls back to running `fn` bare when $executeRawUnsafe is unavailable.
async function savepointed(tx, fn) {
  if (typeof tx.$executeRawUnsafe !== "function") return fn();
  await tx.$executeRawUnsafe("SAVEPOINT economy_entry");
  try {
    const out = await fn();
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT economy_entry");
    return out;
  } catch (err) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT economy_entry");
    throw err;
  }
}

function characterParty(c) {
  if (!c?.id) return null;
  return { kind: "character", id: c.id, name: c.name ?? null, zoneId: c.zoneId ?? null };
}

function roomParty(r) {
  if (!r?.id) return null;
  return { kind: "room", id: r.id, name: r.name ?? null, zoneId: r.zoneId ?? r.location?.zoneId ?? null };
}

// One lookup per TRANSACTION, not per row. Pass `ctx.gameId` to skip it. WeakMap-keyed on `tx` so the entry dies with the transaction, not outliving a wipe.
const gameIdByTx = new WeakMap();

async function currentGameId(tx, ctx) {
  if (ctx?.gameId) return ctx.gameId;
  if (gameIdByTx.has(tx)) return gameIdByTx.get(tx);
  const state = await readGameState(tx, { gameId: true });
  const id = state?.gameId ?? null;
  gameIdByTx.set(tx, id);
  return id;
}

// The one write. `from`/`to` are parties or the MINT/BURN/COMPANY/DEPOT_* constants; `amount` may arrive signed, negative simply swaps the legs.
async function record(tx, { from, to, form, amount, tag, quantity, unitValue }, ctx = {}) {
  try {
    let a = Math.trunc(Number(amount) || 0);
    let src = from ?? null;
    let dst = to ?? null;
    if (a === 0) return null;
    if (a < 0) {
      a = -a;
      const swap = src;
      src = dst;
      dst = swap;
    }
    // Both ends missing would count toward a total no account claims; a single world end (mint, burn) is fine.
    if (!src && !dst) return null;

    const gameId = await currentGameId(tx, ctx);
    if (!gameId) return null;

    // `amount` is INTEGER; clamped not rejected — a wrong-but-huge report number is a bug to find, a lost purchase costs somebody's afternoon.
    if (a > MAX_INT4) a = MAX_INT4;

    return await savepointed(tx, () =>
      tx.economyEntry.create({
        data: {
          gameId,
        turnId: ctx.turnId ?? null,
        turnNumber: ctx.turnNumber ?? null,
        fromKind: src?.kind ?? null,
        fromId: src?.id ?? null,
        fromName: src?.name ?? null,
        toKind: dst?.kind ?? null,
        toId: dst?.id ?? null,
        toName: dst?.name ?? null,
        form: form ?? "BALANCE",
        amount: a,
        tagId: tag?.id ?? null,
        tagSlug: tag?.slug ?? null,
        quantity: quantity ?? null,
        unitValue: unitValue ?? null,
        reason: ctx.reason ?? DEFAULT_REASON,
        actionType: ctx.actionType ?? null,
        auditLogId: ctx.auditLogId ?? null,
        actorDiscordUserId: ctx.actorDiscordUserId ?? null,
        // WHERE it happened, for the GM zone filter — without it every row lands null and the filter matches everything for everybody.
        zoneId: ctx.zoneId ?? src?.zoneId ?? dst?.zoneId ?? null,
        zoneName: ctx.zoneName ?? null,
        locationId: ctx.locationId ?? null,
        roomId: ctx.roomId ?? null,
        secret: Boolean(ctx.secret),
        source: ctx.source ?? "LIVE",
        backfillKey: ctx.backfillKey ?? null,
        },
      }),
    );
  } catch (err) {
    console.error("[economy] ledger write failed:", err?.message ?? err);
    return null;
  }
}

// A signed change to ONE party's balance, world account on the other end; `delta` positive mints into the party, negative burns out of it.
async function recordDelta(tx, party, delta, ctx = {}, form = "BALANCE") {
  if (!party || !delta) return null;
  const d = Math.trunc(Number(delta) || 0);
  return record(tx, d > 0 ? { from: MINT, to: party, form, amount: d } : { from: party, to: BURN, form, amount: -d }, ctx);
}

function turnStamp(turn) {
  if (!turn) return { turnId: null, turnNumber: null };
  return { turnId: turn.id ?? null, turnNumber: turn.number ?? null };
}

module.exports = {
  MINT,
  BURN,
  COMPANY,
  DEPOT_ACCOUNT,
  DEPOT_DEBT,
  characterParty,
  roomParty,
  record,
  recordDelta,
  turnStamp,
};
