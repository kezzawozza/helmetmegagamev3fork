// The craft Move budget: what one craft costs of a turn's Routine, and the
// arithmetic that adds those costs up (docs/systemdocs/CRAFTING.md §2a).
//
// Pure — no prisma, no React — because one model has to hold in three places:
// `craftRequest` enforces it, `character/page.js` summarises it for the sheet,
// and the Craft dialog quotes it before the player commits. A number the
// dialog shows that the server would disagree with is worse than no number.
//
// Costs are FRACTIONS of a Move with small denominators — a recipe's `perTurn`
// ration, or the Dead Simple pool of 4 — kept as integer num/den pairs and
// compared by cross-multiplication. Floats were never an option here: three
// thirds have to be exactly one Move, not 0.9999999999999998 of one.

import { craftFamily } from "./tagRequests";
// The deep path avoids the @lifeweb/db barrel, which unconditionally requires
// @prisma/client and would leak node:fs into a "use client" bundle (this
// module is imported by CraftDialog.js and RequestActionsProvider.js). Same
// shim shape as web/lib/formatTagRequirement.js.
import { formatMoveFraction } from "@lifeweb/db/lib/formatTagRequirement";

const NO_MOVE = { num: 0, den: 1 };
export const WHOLE_MOVE = { num: 1, den: 1 };

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function reduceFraction(num, den) {
  const g = gcd(Math.abs(num), Math.abs(den)) || 1;
  return { num: num / g, den: den / g };
}

export function addFractions(a, b) {
  return reduceFraction(a.num * b.den + b.num * a.den, a.den * b.den);
}

// Does `cost` still fit in what is left? Cross-multiplied, so nothing rounds.
export function fitsInRemaining(cost, remaining) {
  return cost.num * remaining.den <= remaining.num * cost.den;
}

// How many units at 1/den each the remainder still pays for.
export function unitsAffordable(remaining, den) {
  if (!den) return 0;
  return Math.floor((remaining.num * den) / remaining.den);
}

// A ledger's spend and what is left of the Move after it. `1 − a/b` is
// `(b−a)/b`, and stays in lowest terms because a/b already is.
export function ledgerUsed(ledger) {
  if (!ledger) return NO_MOVE;
  return { num: ledger.usedNum ?? 0, den: ledger.usedDen || 1 };
}

export function ledgerRemaining(ledger) {
  const used = ledgerUsed(ledger);
  return reduceFraction(used.den - used.num, used.den);
}

// Just the fraction, for a sentence to sit around — never a word, so a caller
// can say "½ of a Move" or "½ left" without the phrasing being decided here.
// Lives in db/lib/formatTagRequirement.js now (M2) so formatTagRequirement's
// own compact chip line can show the same glyph for a `turnsCost: 1/N` tag —
// db/ cannot import this web/ module, so the shared logic moved down instead
// of growing a second copy. Re-exported here so every existing caller keeps
// importing from where it always did.
export { formatMoveFraction };

// The word for a family of work, as it reads in a sentence: "brewing work",
// "smith's work". The family itself is a skill-slug prefix, which is a key,
// not prose.
const FAMILY_LABELS = {
  brewing: "brewing",
  cooking: "cooking",
  smithing: "smith's",
  builder: "building",
  crafting: "crafting",
  // Off-trade families — any skill prefix can be one now (tagRequests.js).
  butcher: "butcher's",
  blessing: "blessing",
  // Healing (M2, docs/systemdocs/TAGS.md §5c): hardcoded, never derived —
  // craftMoveCost's family override below is what keeps it off craftFamily's
  // guess.
  medical: "medical",
};

export function craftFamilyLabel(family) {
  return FAMILY_LABELS[family] ?? "craft";
}

// What one craft costs of this turn's Move. Five answers:
//
//   free   — no Move at all: a 0-turn recipe inside its free allowance.
//   spill  — some units free, the rest billed at 1/allowance each. Chris's
//            ruling: the allowance is free, going past it costs the Move.
//   capped — past the allowance with no craft family to bill it to. Every
//            recipe derives a family now (tagRequests.js), so this is
//            defensive rather than reachable; kept for rows priced before
//            the generalization.
//   share  — a 1-turn recipe with a Move to pay: quantity × its per-unit
//            work. The work is 1/N of a turn when the YAML writes
//            `turnsCost: 1/N` (the sync stores that as requirementTurns 1 +
//            requirementPerTurn N), and a whole turn otherwise — so
//            `turnsCost: 1` makes one per Routine by plain arithmetic
//            (Chris 2026-09-06). Before this, "whole" priced the Move and
//            not the units, and one Routine bought 99 Broadswords.
//   whole  — the whole Move: a turn on a project.
//
// `allowance`/`freeLeft` are only read on a 0-turn recipe: the ration and how
// much of it today's turn has left. The caller counts those — the server off
// the turn's requests, the dialog off the map the page hands it.
//
// `family` overrides craftFamily(tag)'s guess. Healing needs this (M2,
// docs/systemdocs/TAGS.md §5c): the tag priced here is an AFFLICTION, not a
// recipe, and craftFamily reads requirementSkills off it looking for a trade
// prefix — which finds nothing on a skill-less cure like choking and would
// drop it into the generic `craft` family, sharing a Routine with actual
// crafting. The medic's family is always `medical`, said explicitly by every
// caller that bills a heal or an administer fee.
export function craftMoveCost(
  tag,
  // No default on `family` — it has to stay `undefined` when the caller
  // omits it, not fall to `null`, or a caller passing `family: null` on
  // purpose (moveFamilyOf's never-spills override) would be indistinguishable
  // from one that never passed the option at all: `??` treats both the same.
  { quantity = 1, allowance = null, freeLeft = null, family: familyOverride } = {},
) {
  const turns = tag?.requirementTurns ?? 1;
  const perTurn = tag?.requirementPerTurn ?? null;
  const family = familyOverride !== undefined ? familyOverride : craftFamily(tag);
  const free = (qty) => ({
    kind: "free",
    family,
    freeQty: qty,
    billedQty: 0,
    num: 0,
    den: 1,
    allowance,
  });
  if (turns === 0) {
    // No allowance at all — a 0-turn recipe that is neither Dead Simple nor
    // rationed — stays the free action it has always been.
    if (allowance == null) return free(quantity);
    const covered = Math.max(0, Math.min(quantity, freeLeft ?? allowance));
    const billed = quantity - covered;
    if (billed <= 0) return free(quantity);
    return {
      kind: family ? "spill" : "capped",
      family,
      freeQty: covered,
      billedQty: billed,
      num: billed,
      den: allowance,
      allowance,
    };
  }
  // Only a ONE-turn batch shares the Move. A project (turns ≥ 2) takes the
  // whole Move every turn it runs, `perTurn` or not — its continue path
  // prices at 1/1, and a start that priced as a fraction would disagree with
  // every turn after it. No such recipe exists today; this keeps the first
  // one from finding the seam.
  if (turns === 1 && family) {
    const batch = perTurn > 0 ? perTurn : 1;
    return {
      kind: "share",
      family,
      freeQty: 0,
      billedQty: quantity,
      num: quantity,
      den: batch,
      allowance: batch,
    };
  }
  return {
    kind: "whole",
    family,
    freeQty: 0,
    billedQty: quantity,
    num: 1,
    den: 1,
    allowance: null,
  };
}

// The turn's ledger as the sheet and the dialog read it: which family of work
// the Routine is committed to, and how much of the Move is left. Null unless
// the open turn's Action is a craft Action carrying one.
export function summarizeCraftBudget(action) {
  // `includes`, matching checkCraftMove: other machinery may append to
  // gmNotes, and an appended note must not hide a live ledger.
  if (!action || !(action.gmNotes ?? "").includes("auto:craft") || !action.craftBudget)
    return null;
  const left = ledgerRemaining(action.craftBudget);
  return {
    family: action.craftBudget.family ?? null,
    remainingNum: left.num,
    remainingDen: left.den,
  };
}
