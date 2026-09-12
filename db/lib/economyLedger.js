// The economy ledger's one writer. Every ⬢ that moves, is minted, or is burned
// gets a row here, written INSIDE the caller's transaction so a row never
// records a write that rolled back. /gm/economy reads nothing else.
//
// Takes `tx` as the first parameter, the db/lib/dm.js convention: db/index.js
// is what imports this module, so requiring it back would resolve to a partial
// exports object.
//
// Three rules this file exists to hold in one place:
//
//   1. `amount` is always POSITIVE and the direction is from -> to. A caller
//      that has a signed delta passes it and lets `record` sort out which way
//      round the legs go, so no call site has to think about it.
//   2. A ledger failure NEVER fails the money move. This needs a SAVEPOINT, not
//      a try/catch, and the difference is the whole reason this comment is
//      long. Postgres aborts the entire transaction on a failed statement, and
//      every statement after it fails with 25P02 until the transaction ends —
//      so catching the error in JavaScript does NOT un-abort it. A ledger bug
//      would have taken the player's purchase down with it. The write is
//      therefore fenced between SAVEPOINT and ROLLBACK TO SAVEPOINT, which is
//      the only thing that actually makes a nested failure recoverable.
//   3. A write with no reason is recorded as UNATTRIBUTED, never dropped. An
//      un-hooked call site is then an ugly bar on the panel instead of silently
//      missing money.
const { DEFAULT_REASON } = require("./economyReasons");

// The party kinds. "character" and "room" are real rows; the rest are book
// accounts that exist so every entry has two ends and the supply always adds
// up.
//
// MINT and BURN are the only two things that change the money supply, which is
// why they are named rather than left as a null end — "where did 400 ⬢ come
// from" has to be answerable.
const MINT = { kind: "world", id: "mint", name: "Minted" };
const BURN = { kind: "world", id: "burn", name: "Burned" };
// Off-world. The shuttle is the only door, and ⬢ crossing it are a ware bought
// and sold at a spread (DEPOT.md) — not a transfer between two players.
const COMPANY = { kind: "offworld", id: "company", name: "The Company" };
// The Depot's two books. Deliberately separate accounts, because the station's
// float and the Merchant's own purse are NOT the same money (DEPOT.md §0g) and
// summing them would be a lie the panel tells on its front page.
const DEPOT_ACCOUNT = { kind: "depot", id: "account", name: "Depot account" };
const DEPOT_DEBT = { kind: "depot", id: "debt", name: "The Company's line" };

const MAX_INT4 = 2147483647;

// Runs `fn` fenced by a SAVEPOINT so a failure inside it cannot poison the
// caller's transaction.
//
// This is the only correct shape for "best effort inside somebody else's
// transaction" on Postgres. Without it, a failed INSERT here puts the
// connection in 25P02 and every later statement in the caller's $transaction
// fails too — the money move included. A try/catch alone reads like it handles
// that and does not.
//
// If the savepoint statements themselves are unavailable (a client that does
// not expose $executeRawUnsafe), fall back to running `fn` bare: the ledger
// row is still worth attempting, and the caller is no worse off than before
// this module existed.
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

// A character or Room resolved to a party. Accepts the shape db/lib/parties.js
// already returns, so a caller that has a party passes it straight through.
function characterParty(c) {
  if (!c?.id) return null;
  return { kind: "character", id: c.id, name: c.name ?? null };
}

function roomParty(r) {
  if (!r?.id) return null;
  return { kind: "room", id: r.id, name: r.name ?? null };
}

// GameState holds the current gameId (there is one row). Looked up once per
// write when the caller does not supply it — cheap and indexed, and
// correctness matters more here than the read: a row on the wrong game is a
// row in the wrong book. Pass `ctx.gameId` to skip it.
async function currentGameId(tx, ctx) {
  if (ctx?.gameId) return ctx.gameId;
  const state = await tx.gameState.findFirst({ select: { gameId: true } });
  return state?.gameId ?? null;
}

// The one write.
//
// `from` and `to` are parties (or the MINT/BURN/COMPANY/DEPOT_* constants).
// `amount` may arrive signed: negative simply swaps the legs.
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
    // Both ends missing means nobody can say what happened, and a row like
    // that is worse than none — it would count toward a total no account
    // claims. A single world end is fine and normal (a mint, a burn).
    if (!src && !dst) return null;

    const gameId = await currentGameId(tx, ctx);
    if (!gameId) return null;

    // `amount` is INTEGER in the database. A stack of a high-priced tag can
    // multiply past int4 and raise, which before the savepoint below would
    // have rolled back the player's whole action. Clamped rather than
    // rejected: a wrong-but-huge number on a report is a bug to find, a lost
    // purchase is a bug that costs somebody their afternoon.
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
        zoneId: ctx.zoneId ?? null,
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
    // Rule 2. Never let the book cost somebody their purchase.
    console.error("[economy] ledger write failed:", err?.message ?? err);
    return null;
  }
}

// A signed change to ONE party's balance, with the other end a world account.
// This is what the balance chokepoints call: `delta` positive is a mint into
// the party, negative is a burn out of it.
async function recordDelta(tx, party, delta, ctx = {}, form = "BALANCE") {
  if (!party || !delta) return null;
  const d = Math.trunc(Number(delta) || 0);
  return record(tx, d > 0 ? { from: MINT, to: party, form, amount: d } : { from: party, to: BURN, form, amount: -d }, ctx);
}

// Turn stamps for a context, from whatever the call site happens to be holding.
// Every caller has SOME shape of the open turn in scope and almost none of them
// has the same one, so this takes all of them.
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
