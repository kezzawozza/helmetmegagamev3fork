// Canonical Labor ranges (docs/systemdocs/LABORING.md). Single source of truth
// for the labor resolver (db/lib/laborAccess.js) and web/lib/referenceData.js's
// getProductionRates, which backs the {resource:labor:tier} bubbles in
// docs/tags.yaml — change a range here, not in either of those places.
// `labor` is the only field key (two-level {field: {tier}} shape for the
// renderers). Two general tiers, made anywhere; the specialisations are
// scaled by the Location's own coefficient (LocationYield.current), so the
// range here is the value at coefficient 1.0. No `base` tier: holding no
// Laboring tag means you cannot labor, not that you labor badly. Prospecting
// pays less than the other three on purpose — a Labor drop (LABORDROPS.md)
// makes up the rest of its value in items rather than ⬢.
const PRODUCTION_RATES = {
  labor: {
    basic: { min: 0, max: 3 },
    skilled: { min: 2, max: 6 },
    hunting: { min: 0, max: 15 },
    farming: { min: 15, max: 21 },
    fishing: { min: 7, max: 13 },
    prospecting: { min: 2, max: 8 },
  },
};

// Location-scaled specialisation tiers -> LaborKind. Plain object so both
// directions are cheap — db/lib/laborAccess.js needs tier->kind, the Labor?
// button needs kind->tier.
const SPECIALISATION_KINDS = {
  hunting: "HUNTING",
  farming: "FARMING",
  fishing: "FISHING",
  prospecting: "PROSPECTING",
};

// The one tier the global dial cannot touch: Basic is the floor of the whole
// economy, and rebalancing the specialists must not quietly delete it.
const UNSCALED_TIERS = new Set(["basic"]);

// No min>max guard: Math.round is monotonic and no multiplier is ever
// negative, so min <= max survives by construction; a small coefficient
// collapsing 1-4 to 0-0 is correct, not a bug. `coefficient` is the global
// GameConfig dial; `locationCoefficient` is LocationYield.current. They multiply.
function computeRate(field, tier, coefficient, locationCoefficient = 1) {
  const rate = PRODUCTION_RATES[field]?.[tier];
  if (rate == null) return null;
  const c = UNSCALED_TIERS.has(tier) ? 1 : (coefficient ?? 1) * (locationCoefficient ?? 1);
  return { min: Math.round(rate.min * c), max: Math.round(rate.max * c) };
}

// Display form — "3" when fixed, "0–4" (en dash) when it varies. The one
// place that dash is written; the API serves the result.
function formatRate(rate) {
  if (!rate) return null;
  return rate.min === rate.max ? String(rate.min) : `${rate.min}–${rate.max}`;
}

function rollRate(rate) {
  if (!rate) return null;
  return rate.min + Math.floor(Math.random() * (rate.max - rate.min + 1));
}

module.exports = { PRODUCTION_RATES, SPECIALISATION_KINDS, UNSCALED_TIERS, computeRate, formatRate, rollRate };
