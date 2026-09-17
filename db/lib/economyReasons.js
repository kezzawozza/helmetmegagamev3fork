// The economy's vocabulary: why ⬢ moved, and how a reader should group it. A plain string on
// EconomyEntry.reason, not a Prisma enum, for the reason AuditLog.actionType is one — the list grows
// and a migration per reason is a tax nobody would pay. This module is the ONLY place it is authored.
// Zero requires, ever, like db/lib/dmKinds.js — reachable from a client component (the /gm/economy
// chips), and one require of @lifeweb/db here would drag PrismaClient into the browser bundle.

// How a reason behaves in the books — what Faucets/Sinks group on and the supply chart uses to tell a
// mint from a hand-over. FAUCET: ⬢ that didn't exist before, supply up. SINK: ⬢ stops existing, supply
// down. TRANSFER: ⬢ changes hands, supply unchanged, velocity up. INTERNAL: a form change, not a
// movement (the ATM turning balance into coin) — must be excluded from velocity or a Depot trip counts twice.
const FLOW = { FAUCET: "FAUCET", SINK: "SINK", TRANSFER: "TRANSFER", INTERNAL: "INTERNAL" };

// reason -> { flow, label }. Label is prose a GM reads, never the word "Resources" beside a ⬢ glyph.
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
  // Dead since the hunger rework (db/lib/hunger.js): Hunger is a 0-100 meter
  // now, with no ⬢ cost at all. Kept here, unwritten, because historic
  // EconomyEntry rows still name this reason and the reconciliation math over
  // them must keep resolving it to a label.
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
  // The two silent burns — before the ledger, neither left a trace: the Spillway just dropped what
  // was put in, and a debit larger than a balance destroyed the shortfall against a GREATEST(0,...) floor.
  SPILLWAY: { flow: FLOW.SINK, label: "Spillway" },
  CLAMP: { flow: FLOW.SINK, label: "Overdrawn (destroyed)" },
  GM_TAKE: { flow: FLOW.SINK, label: "GM removal" },

  // --- transfers ---
  TRANSFER: { flow: FLOW.TRANSFER, label: "Hand-over" },
  LOOT: { flow: FLOW.TRANSFER, label: "Looted" },
  TAX: { flow: FLOW.TRANSFER, label: "Tax" },
  CARRY_SPILL: { flow: FLOW.TRANSFER, label: "Dropped (overburdened)" },
  GM_TRANSFER: { flow: FLOW.TRANSFER, label: "GM transfer" },
  STAGED_PUSH: { flow: FLOW.TRANSFER, label: "Adjudication push" },
  STASH: { flow: FLOW.TRANSFER, label: "Stash" },
  DEPOT_ORDER: { flow: FLOW.TRANSFER, label: "Depot order" },
  DEPOT_SALE: { flow: FLOW.TRANSFER, label: "Depot sale" },
  DEPOT_REFUEL: { flow: FLOW.TRANSFER, label: "Refuelled" },

  // --- internal (a form change, not a movement) ---
  DEPOT_ATM: { flow: FLOW.INTERNAL, label: "ATM" },
  DEPOT_CREDIT: { flow: FLOW.INTERNAL, label: "Credit line" },

  // --- the honest ones ---
  // A write reached the ledger with no reason. Deliberately loud on /gm/economy as its own bar, so an
  // un-hooked call site is visible instead of quietly missing — never filter it out on the read side.
  UNATTRIBUTED: { flow: FLOW.INTERNAL, label: "Unattributed" },
  // What the AuditLog backfill couldn't account for, written once per account so the books close at
  // the seam. Its size is a diagnostic, not a number to trust.
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
