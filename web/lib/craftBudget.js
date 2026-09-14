// The craft Move budget: what one craft costs of a turn's Routine (docs/systemdocs/CRAFTING.md §2a). Costs are FRACTIONS with small denominators, num/den pairs compared by cross-multiplication.

import { craftFamily } from "./tagRequests";
// Deep path avoids the @lifeweb/db barrel (leaks node:fs into "use client" bundles); same shim as formatTagRequirement.js.
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

export function ledgerUsed(ledger) {
  if (!ledger) return NO_MOVE;
  return { num: ledger.usedNum ?? 0, den: ledger.usedDen || 1 };
}

export function ledgerRemaining(ledger) {
  const used = ledgerUsed(ledger);
  return reduceFraction(used.den - used.num, used.den);
}

// Lives in db/lib/formatTagRequirement.js (M2); re-exported so every existing caller keeps its import path.
export { formatMoveFraction };

// The word for a family of work, as it reads in a sentence: "brewing work", "smith's work".
const FAMILY_LABELS = {
  brewing: "brewing",
  cooking: "cooking",
  smithing: "smith's",
  builder: "building",
  crafting: "crafting",
  butcher: "butcher's",
  blessing: "blessing",
  // medical is hardcoded (M2, TAGS.md §5c), kept off craftFamily's guess by craftMoveCost's override.
  medical: "medical",
};

export function craftFamilyLabel(family) {
  return FAMILY_LABELS[family] ?? "craft";
}

// What one craft costs of this turn's Move: free/spill/capped (0-turn, vs. an allowance), share (1-turn
// recipe, 1/N of a turn, Chris 2026-09-06) or whole (a project turn). `family` overrides craftFamily's guess (TAGS.md §5c).
export function craftMoveCost(
  tag,
  // No default on `family`: must stay `undefined` when omitted, or moveFamilyOf's `family: null` override would be indistinguishable via `??`.
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
  // Only a ONE-turn batch shares the Move; a project (turns ≥ 2) takes the whole Move every turn.
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

// The turn's ledger as the sheet and the dialog read it; null unless the open turn's Action carries one.
export function summarizeCraftBudget(action) {
  // `includes`, matching checkCraftMove: other machinery may append to gmNotes, and must not hide a live ledger.
  if (!action || !(action.gmNotes ?? "").includes("auto:craft") || !action.craftBudget)
    return null;
  const left = ledgerRemaining(action.craftBudget);
  return {
    family: action.craftBudget.family ?? null,
    remainingNum: left.num,
    remainingDen: left.den,
  };
}
