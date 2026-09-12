// Canonical Labor ranges (see docs/systemdocs/LABORING.md). Single source of
// truth for the labor resolver (db/lib/laborAccess.js) and for
// web/lib/referenceData.js's getProductionRates, which backs the
// {resource:labor:tier} bubbles docs/tags.yaml's Laboring descriptions render
// through — change a range here, not in either of those places.
//
// One flavor, one field: `labor` is still the only key. The two-level
// {field: {tier}} shape is what the {resource:labor:tier} renderers need, and
// the five tiers below all live under it.
//
// Two general tiers and three specialisations. The general tiers are what you
// make anywhere; a specialisation is scaled by the Location's own coefficient
// (LocationYield.current) before anything else happens to it, so its range
// here is what it pays at a coefficient of exactly 1.0.
//
// There is deliberately no `base` tier any more. Holding no Laboring tag at
// all means you cannot labor, rather than laboring badly.
// Raised ~8% on 2026-09-06, Bascinet's call, applied to these base values
// rather than to GameConfig.productionCoefficient — the dial exempts Basic
// (UNSCALED_TIERS) and would have missed it. The two general tiers did not
// actually move: 2 x 1.08 = 2.16 and 4 x 1.08 = 4.32 both round back to where
// they started, and one whole point on those is 25-50%, which is not an 8%
// boost by any reading. So the rise lands on the three specialisations, which
// is where the volume is anyway.
//
// Then split apart on 2026-09-06, so the three stopped being a near-tie and
// the richest ground stopped being the wilderness: hunting -20%, fishing -15%,
// farming +10%. Rounded per endpoint, and whole numbers do not let those land
// exactly — hunting 0-19 -> 0-15 (-21.1% on the average, since 0-16 would be
// only -15.8%), fishing 8-15 -> 7-13 (-13.0%), farming 13-17 -> 14-19
// (+10.0%). The general tiers are untouched again, for the reason above.
//
// Farming raised a further 9% on 2026-09-06: 14-19 -> 15-21, an average of
// 16.5 -> 18.0, or +9.09% — the closest whole-number pair to the intent.
// Prospecting joined 2026-09-09 as the fourth specialisation. Its 2-8 pays
// less than the other three — Bascinet's call, on purpose: a Labor drop
// (LABORDROPS.md) is meant to make up the rest of Prospecting's value in
// items rather than ⬢, which none of the other three lean on this hard.
//
// Basic and Skilled both raised ~30% on 2026-09-12, rounded up: basic 0-2 ->
// 0-3 (2*1.3=2.6), skilled 1-4 -> 2-6 (1*1.3=1.3, 4*1.3=5.2).
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

// Which tiers are the location-scaled specialisations, and the LaborKind each
// maps to. Ordinary object rather than a Set so both directions are cheap —
// db/lib/laborAccess.js needs tier -> kind, the Labor? button needs kind ->
// tier.
const SPECIALISATION_KINDS = {
  hunting: "HUNTING",
  farming: "FARMING",
  fishing: "FISHING",
  prospecting: "PROSPECTING",
};

// The one tier the global dial cannot touch. Basic is the floor of the whole
// economy — "you can sometimes provide for yourself" — and a GM dropping
// productionCoefficient to rebalance the specialists must not quietly delete
// subsistence along with it.
const UNSCALED_TIERS = new Set(["basic"]);

// Both ends scale independently. No min>max guard on purpose: Math.round is
// monotonic and no multiplier here is ever negative, so min <= max survives the
// scaling by construction — a clamp here would only hide a coefficient that
// had gone genuinely wrong. A small coefficient collapsing 1-4 to 0-0 is
// correct, not a bug.
//
// `coefficient` is the global GameConfig dial; `locationCoefficient` is the
// Location's own LocationYield.current for this kind. They multiply.
function computeRate(field, tier, coefficient, locationCoefficient = 1) {
  const rate = PRODUCTION_RATES[field]?.[tier];
  if (rate == null) return null;
  const c = UNSCALED_TIERS.has(tier) ? 1 : (coefficient ?? 1) * (locationCoefficient ?? 1);
  return { min: Math.round(rate.min * c), max: Math.round(rate.max * c) };
}

// Display form for a rate — "3" when it can't vary, "0–4" (en dash) when it
// can. The one place that dash is written; the API serves the result so no
// client component has to reimplement it.
function formatRate(rate) {
  if (!rate) return null;
  return rate.min === rate.max ? String(rate.min) : `${rate.min}–${rate.max}`;
}

function rollRate(rate) {
  if (!rate) return null;
  return rate.min + Math.floor(Math.random() * (rate.max - rate.min + 1));
}

module.exports = { PRODUCTION_RATES, SPECIALISATION_KINDS, UNSCALED_TIERS, computeRate, formatRate, rollRate };
