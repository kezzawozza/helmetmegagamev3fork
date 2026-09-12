// Reconstructs economy entries from AuditLog rows written BEFORE the ledger
// existed. Read by db/scripts/ops/backfill-economy.js and nothing else.
//
// Why this is awkward, and why the awkwardness is recorded here rather than
// smoothed over: AuditLog.details is free-form Json and every call site named
// its number differently. The same amount is `resourcesSpent` in one place,
// `resourcesGranted` in another, `amount`, `total`, `payout`, or plain
// `resources` elsewhere. web/lib/auditNarrative.js is the de-facto registry of
// that — it is the file that already knows which key each action used — so this
// table was built against it, not against a grep.
//
// What this CANNOT recover, and must not pretend to:
//
//   - the per-character passes. Hunger, horse upkeep, tax and carry each wrote
//     ONE summary row per pass with a total, not a delta per person.
//   - the Spillway and the overdraw clamp, which wrote nothing at all.
//   - anything whose details blob simply did not carry the number.
//
// Those are what the PLUG row exists for: after a backfill, each account gets
// one entry sized to the difference between its reconstructed sum and its live
// balance, so the books close at the seam. The size of a plug is a diagnostic,
// not a number to trust.

// Party helpers. A backfilled row's ends are whatever the blob recorded, which
// is often a name and no id — that is fine and expected for a log table whose
// columns are snapshots anyway.
function party(kind, id, name) {
  if (!kind && !name && !id) return null;
  return { kind: kind ?? "character", id: id ?? null, name: name ?? null };
}

function target(entry) {
  return entry.targetCharacterId
    ? party("character", entry.targetCharacterId, entry.details?.characterName ?? entry.details?.targetName ?? null)
    : null;
}

// A party recorded as `{ kind, id, name }` — the shape gm_transfer_resources
// used, which is the cleanest machine-readable transfer row in the old data.
function blobParty(p) {
  if (!p) return null;
  if (typeof p === "string") {
    const [kind, id] = p.split(":");
    return id ? party(kind, id, null) : party("character", null, p);
  }
  return party(p.kind, p.id, p.name);
}

// The book accounts come from the ledger itself. They were briefly re-declared
// here with identical values, which is the one duplication in this system that
// actually costs something: two copies of the accounts that define the
// double-entry universe drift, and then the backfill and the live hooks
// disagree about what "the Company" is.
const { MINT, BURN, COMPANY, DEPOT_ACCOUNT: ACCOUNT, DEPOT_DEBT: DEBT } = require("./economyLedger");

const n = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

// actionType -> (entry) -> array of { from, to, form, amount, reason, secret }
//
// Returning an ARRAY because one audit row can be several movements: a depot
// order is money out and goods in.
const ADAPTERS = {
  // --- the Depot, whose blobs are the best-shaped in the old data ---
  request_depot_order: (e) => [
    { from: ACCOUNT, to: COMPANY, form: "ACCOUNT", amount: n(e.details?.total), reason: "DEPOT_ORDER" },
  ],
  request_depot_shuttle_send: (e) =>
    e.details?.direction === "UP"
      ? [{ from: COMPANY, to: ACCOUNT, form: "ACCOUNT", amount: n(e.details?.payout), reason: "DEPOT_SALE" }]
      : [],
  request_depot_atm: (e) => {
    const amt = n(e.details?.amount);
    const out = e.details?.direction === "WITHDRAW";
    // A form change, not a mint: the account becomes coin in a pocket.
    return [
      out
        ? { from: ACCOUNT, to: target(e), form: "COIN", amount: amt, reason: "DEPOT_ATM" }
        : { from: target(e), to: ACCOUNT, form: "COIN", amount: amt, reason: "DEPOT_ATM" },
    ];
  },
  request_depot_credit: (e) => {
    const amt = n(e.details?.amount);
    const draw = e.details?.direction === "DRAW";
    return [
      draw
        ? { from: COMPANY, to: DEBT, form: "DEBT", amount: amt, reason: "DEPOT_CREDIT" }
        : { from: DEBT, to: COMPANY, form: "DEBT", amount: amt, reason: "DEPOT_CREDIT" },
      draw
        ? { from: COMPANY, to: ACCOUNT, form: "ACCOUNT", amount: amt, reason: "DEPOT_CREDIT" }
        : { from: ACCOUNT, to: COMPANY, form: "ACCOUNT", amount: amt, reason: "DEPOT_CREDIT" },
    ];
  },

  // --- transfers, the rows that actually name both ends ---
  request_transfer_resources: (e) => [
    {
      from: blobParty(e.details?.from),
      to: blobParty(e.details?.to),
      form: "BALANCE",
      amount: n(e.details?.amount),
      reason: "TRANSFER",
    },
  ],
  gm_transfer_resources: (e) => [
    {
      from: blobParty(e.details?.from),
      to: blobParty(e.details?.to),
      form: "BALANCE",
      amount: n(e.details?.amount),
      reason: "GM_TRANSFER",
    },
  ],
  request_loot_character: (e) => [
    {
      from: blobParty(e.details?.from) ?? target(e),
      to: blobParty(e.details?.to),
      form: "BALANCE",
      amount: n(e.details?.resources ?? e.details?.amount),
      reason: "LOOT",
    },
  ],
  carry_overflow_dropped: (e) => [
    {
      from: target(e),
      to: party("room", e.roomId, e.details?.roomName),
      form: "BALANCE",
      amount: n(e.details?.resources),
      reason: "CARRY_SPILL",
    },
  ],

  // --- straightforward sinks: a cost named in the blob ---
  request_craft_tag: (e) => spend(e, "CRAFT"),
  request_heal_character: (e) => spend(e, "MEDICAL"),
  request_trinket_craft: (e) => spend(e, "TRINKET"),
  request_engrave_headstone: (e) => spend(e, "ENGRAVE"),
  thanati_purchase: (e) => spend(e, "THANATI", true),

  // --- faucets ---
  //
  // Three more used to sit here and could never fire, because the action moves
  // no ⬢ at all: caving grants a tag rather than coin, character_created
  // records the tag-point budget rather than the role's starting purse, and
  // threat_assigned records tagPoints. Their ⬢, where there is any, reaches
  // the books as a PLUG instead. Do not re-add a mapping without reading the
  // writer's details blob first.
  request_consume_tag: (e) => grant(e, "CONSUME"),
};

// The two generic shapes. Most of the old rows are one of these: a number the
// actor paid, or a number the actor was given.
// The key names here are not a guess and not a superset "just in case" — each
// one is a key some real writer actually uses, and the list grew when a review
// found four mappings silently producing nothing because the key they read was
// not the key the call site wrote. `spent` is Engrave
// (requestActions.js#request_engrave_headstone), `total` is the Thanati
// purchase (thanatiActions.js). Check the writer before adding another.
function spend(e, reason, secret = false) {
  const d = e.details ?? {};
  const amt = n(d.resourcesSpent ?? d.cost ?? d.spent ?? d.total ?? d.resources);
  return [{ from: target(e), to: BURN, form: "BALANCE", amount: amt, reason, secret }];
}

function grant(e, reason, secret = false) {
  const amt = n(e.details?.resourcesGranted ?? e.details?.resources ?? e.details?.startingResources);
  return [{ from: MINT, to: target(e), form: "BALANCE", amount: amt, reason, secret }];
}

// One audit row -> the movements it stands for. Unknown action types and
// zero-amount rows yield nothing, and the script COUNTS what it skipped so the
// coverage is reported rather than assumed.
function adapt(entry) {
  const fn = ADAPTERS[entry.actionType];
  if (!fn) return [];
  let rows = [];
  try {
    rows = fn(entry) ?? [];
  } catch {
    return [];
  }
  return rows.filter((r) => r && r.amount > 0 && (r.from || r.to));
}

module.exports = { adapt };
