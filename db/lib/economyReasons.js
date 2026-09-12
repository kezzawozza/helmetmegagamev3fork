// The economy's vocabulary: why ⬢ moved, and how a reader should group it.
//
// A plain string on EconomyEntry.reason rather than a Prisma enum, for the same
// reason AuditLog.actionType is a string — the list grows, and a migration per
// new reason is a tax nobody would pay. This module is the ONLY place it is
// authored.
//
// Like db/lib/dmKinds.js this file has ZERO REQUIRES, ever. It is reachable
// from a client component (the reason chips on /gm/economy), and one require of
// @lifeweb/db here would drag PrismaClient into the browser bundle.

// How a reason behaves in the books. This is what the Faucets and Sinks
// sections group on, and what the supply chart uses to tell a mint from a
// hand-over.
//
//   FAUCET   — ⬢ that did not exist before. Supply goes up.
//   SINK     — ⬢ that stops existing. Supply goes down.
//   TRANSFER — ⬢ changing hands. Supply is unchanged, velocity goes up.
//   INTERNAL — a form change, not a movement: the ATM turning a balance into
//              coin, an order becoming a manifest. Supply unchanged, and these
//              must be excluded from velocity or every trip through the Depot
//              counts twice.
const FLOW = { FAUCET: "FAUCET", SINK: "SINK", TRANSFER: "TRANSFER", INTERNAL: "INTERNAL" };

// reason -> { flow, label }. The label is what a GM reads; it is prose, not a
// key, and it never contains the word "Resources" beside a ⬢ glyph.
const REASONS = {
  // --- faucets ---
  LABOR: { flow: FLOW.FAUCET, label: "Labor" },
  LABOR_DROP: { flow: FLOW.FAUCET, label: "Labor drop" },
  CRATE: { flow: FLOW.FAUCET, label: "Crate opened" },
  CONSUME: { flow: FLOW.FAUCET, label: "Purse consumed" },
  RITE_GRANT: { flow: FLOW.FAUCET, label: "Rite" },
  THREAT_SPAWN: { flow: FLOW.FAUCET, label: "Threat spawned" },
  CHARACTER_START: { flow: FLOW.FAUCET, label: "Starting purse" },
  STRUCTURE_YIELD: { flow: FLOW.FAUCET, label: "Structure yield" },
  CAVING: { flow: FLOW.FAUCET, label: "Caving" },
  GM_GRANT: { flow: FLOW.FAUCET, label: "GM grant" },
  OPENING: { flow: FLOW.FAUCET, label: "Opening balance" },

  // --- sinks ---
  HUNGER: { flow: FLOW.SINK, label: "Hunger" },
  UPKEEP: { flow: FLOW.SINK, label: "Upkeep" },
  CRAFT: { flow: FLOW.SINK, label: "Crafting" },
  BUILD: { flow: FLOW.SINK, label: "Building" },
  TRINKET: { flow: FLOW.SINK, label: "Trinket" },
  MEDICAL: { flow: FLOW.SINK, label: "Medicine" },
  ENGRAVE: { flow: FLOW.SINK, label: "Engraving" },
  RITE_COST: { flow: FLOW.SINK, label: "Rite cost" },
  THANATI: { flow: FLOW.SINK, label: "Cult purchase" },
  LESSON: { flow: FLOW.SINK, label: "Lesson" },
  // The two silent burns. Before the ledger, neither left a trace anywhere:
  // the Spillway just dropped what was put into it, and a debit larger than a
  // balance destroyed the shortfall against a GREATEST(0, ...) floor.
  SPILLWAY: { flow: FLOW.SINK, label: "Spillway" },
  CLAMP: { flow: FLOW.SINK, label: "Overdrawn (destroyed)" },
  GM_TAKE: { flow: FLOW.SINK, label: "GM removal" },

  // --- transfers ---
  TRANSFER: { flow: FLOW.TRANSFER, label: "Hand-over" },
  LOOT: { flow: FLOW.TRANSFER, label: "Looted" },
  TAX: { flow: FLOW.TRANSFER, label: "Tax" },
  CARRY_SPILL: { flow: FLOW.TRANSFER, label: "Dropped (overburdened)" },
  GM_TRANSFER: { flow: FLOW.TRANSFER, label: "GM transfer" },
  STASH: { flow: FLOW.TRANSFER, label: "Stash" },
  DEPOT_ORDER: { flow: FLOW.TRANSFER, label: "Depot order" },
  DEPOT_SALE: { flow: FLOW.TRANSFER, label: "Depot sale" },
  DEPOT_REFUEL: { flow: FLOW.TRANSFER, label: "Refuelled" },

  // --- internal (a form change, not a movement) ---
  DEPOT_ATM: { flow: FLOW.INTERNAL, label: "ATM" },
  DEPOT_CREDIT: { flow: FLOW.INTERNAL, label: "Credit line" },

  // --- the honest ones ---
  // A write reached the ledger with no reason. Deliberately loud: it shows up
  // on /gm/economy as its own bar so an un-hooked call site is visible instead
  // of quietly missing. NEVER quiet one by filtering it out on the read side —
  // give the call site its reason.
  UNATTRIBUTED: { flow: FLOW.INTERNAL, label: "Unattributed" },
  // What the AuditLog backfill could not account for, written once per account
  // so the books close at the seam. Its size is a diagnostic, not a number to
  // trust.
  PLUG: { flow: FLOW.INTERNAL, label: "Unreconciled (before the ledger)" },
};

const DEFAULT_REASON = "UNATTRIBUTED";

function reasonFlow(reason) {
  return REASONS[reason]?.flow ?? FLOW.INTERNAL;
}

function reasonLabel(reason) {
  return REASONS[reason]?.label ?? reason ?? "Unknown";
}

module.exports = { FLOW, REASONS, DEFAULT_REASON, reasonFlow, reasonLabel };
