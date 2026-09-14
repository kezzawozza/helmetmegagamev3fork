// Reconstructs economy entries from AuditLog rows written BEFORE the ledger
// existed. Read by db/scripts/ops/backfill-economy.js and nothing else.
// AuditLog.details is free-form Json with inconsistent key names across call
// sites; this table was built against web/lib/auditNarrative.js, the de-facto
// key registry, not against a grep. CANNOT recover per-character passes (one
// summary row per pass, not a delta per person), the Spillway/overdraw clamp
// (wrote nothing), or blobs lacking the number — the PLUG row covers that gap,
// sized to the difference between reconstructed and live balance; its size is
// a diagnostic, not a number to trust.

// A backfilled row's ends are whatever the blob recorded — often a name and no id, expected for a
// log table whose columns are snapshots anyway.
function party(kind, id, name) {
  if (!kind && !name && !id) return null;
  return { kind: kind ?? "character", id: id ?? null, name: name ?? null };
}

function target(entry) {
  return entry.targetCharacterId
    ? party("character", entry.targetCharacterId, entry.details?.characterName ?? entry.details?.targetName ?? null)
    : null;
}

// `{ kind, id, name }` — the shape gm_transfer_resources used, the cleanest machine-readable
// transfer row in the old data.
function blobParty(p) {
  if (!p) return null;
  if (typeof p === "string") {
    const [kind, id] = p.split(":");
    return id ? party(kind, id, null) : party("character", null, p);
  }
  return party(p.kind, p.id, p.name);
}

// From the ledger itself — a re-declared copy here would let the backfill and the live hooks
// disagree about what "the Company" is.
const { MINT, BURN, COMPANY, DEPOT_ACCOUNT: ACCOUNT, DEPOT_DEBT: DEBT } = require("./economyLedger");

const n = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

// actionType -> (entry) -> array of { from, to, form, amount, reason, secret }.
// Array because one audit row can be several movements (a depot order is money out, goods in).
const ADAPTERS = {
  request_depot_order: (e) => [
    { from: ACCOUNT, to: COMPANY, form: "ACCOUNT", amount: n(e.details?.total), reason: "DEPOT_ORDER" },
  ],
  request_depot_shuttle_send: (e) =>
    e.details?.direction === "UP"
      ? [{ from: COMPANY, to: ACCOUNT, form: "ACCOUNT", amount: n(e.details?.payout), reason: "DEPOT_SALE" }]
      : [],
  request_depot_atm: (e) => {
    const amt = n(e.details?.amount);
    const out = e.details?.direction === "WITHDRAW"; // form change, not a mint: account -> coin in pocket
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

  request_craft_tag: (e) => spend(e, "CRAFT"),
  request_heal_character: (e) => spend(e, "MEDICAL"),
  request_trinket_craft: (e) => spend(e, "TRINKET"),
  request_engrave_headstone: (e) => spend(e, "ENGRAVE"),
  thanati_purchase: (e) => spend(e, "THANATI", true),

  // caving/character_created/threat_assigned move no ⬢; their ⬢ reaches the books as a PLUG.
  // Do not re-add a mapping without reading the writer's details blob first.
  request_consume_tag: (e) => grant(e, "CONSUME"),
};

// The two generic shapes: a number the actor paid, or was given. Key names
// here are each a key some real writer actually uses, not a guessed superset
// — `spent` is Engrave (requestActions.js#request_engrave_headstone), `total`
// is the Thanati purchase (thanatiActions.js). Check the writer before adding another.
function spend(e, reason, secret = false) {
  const d = e.details ?? {};
  const amt = n(d.resourcesSpent ?? d.cost ?? d.spent ?? d.total ?? d.resources);
  return [{ from: target(e), to: BURN, form: "BALANCE", amount: amt, reason, secret }];
}

function grant(e, reason, secret = false) {
  const amt = n(e.details?.resourcesGranted ?? e.details?.resources ?? e.details?.startingResources);
  return [{ from: MINT, to: target(e), form: "BALANCE", amount: amt, reason, secret }];
}

// Unknown action types and zero-amount rows yield nothing; the script COUNTS what it skipped.
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
