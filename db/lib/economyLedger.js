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
//   2. A ledger failure NEVER fails the money move. The write is wrapped, and a
//      row that cannot be written is logged and dropped — the reconciliation
//      check on /gm/economy is what catches the gap. Same reasoning as
//      chargeWoundMood in db/lib/tagWrites.js: a bookkeeping hiccup must not
//      cost a player their purchase.
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
const DEPOT_MANIFEST = { kind: "depot", id: "manifest", name: "On the manifest" };

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

    return await tx.economyEntry.create({
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
    });
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

// Builds a context from the things a request handler usually has: the open
// turn, the acting character (for place columns), and the reason.
function context({ reason, turn, actor, character, actionType, auditLogId, secret, gameId, source, backfillKey } = {}) {
  return {
    reason: reason ?? DEFAULT_REASON,
    ...turnStamp(turn),
    actorDiscordUserId: actor ?? character?.discordUserId ?? null,
    zoneId: character?.zoneId ?? null,
    zoneName: character?.zone?.name ?? character?.zoneName ?? null,
    locationId: character?.locationId ?? null,
    roomId: character?.roomId ?? null,
    actionType: actionType ?? null,
    auditLogId: auditLogId ?? null,
    secret: Boolean(secret),
    gameId: gameId ?? null,
    source: source ?? "LIVE",
    backfillKey: backfillKey ?? null,
  };
}

module.exports = {
  MINT,
  BURN,
  COMPANY,
  DEPOT_ACCOUNT,
  DEPOT_DEBT,
  DEPOT_MANIFEST,
  characterParty,
  roomParty,
  record,
  recordDelta,
  context,
  turnStamp,
};
