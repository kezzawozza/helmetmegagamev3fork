const { LABORING_SCAVENGING_SLUG } = require("./constants");
// The labor drop die: what a Labor payout can find, on top of its ⬢ (docs/systemdocs/LABORDROPS.md).
// Config lives in LaborDropOption, synced from docs/labordrops.yaml by db/lib/syncLaborDrops.js. This
// file is the reading half. The draw is TWO-STAGE (db/lib/labordropsRarity.js owns the rarity math;
// this file owns finding the pool). A row may ALSO carry requiredTagId, a post-filter gate applied by
// passesRequiredTag below, orthogonal to the six SQL-side scopes.

// db/lib/laborAccess.js#resolveLaborRateFrom's own tier strings. "refining" has no entry — the Godard
// Factory pays in goods, not a die (FACTORY.md); db/lib/moveEffects.js's laborDrop effect skips it.
const { drawFromPool } = require("./labordropsRarity");

const TIER_TO_LABOR_DROP_TYPE = {
  basic: "BASIC",
  skilled: "SKILLED",
  hunting: "HUNTING",
  farming: "FARMING",
  fishing: "FISHING",
  prospecting: "PROSPECTING",
};

// The six legal scope combinations a pool can be authored under (LABORDROPS.md §2). Never zone AND
// location together — the sync refuses to write it.
function scopeFilters(laborType, zoneId, locationId) {
  const filters = [{ laborType: null, zoneId: null, locationId: null }]; // Global
  if (laborType) filters.push({ laborType, zoneId: null, locationId: null });
  if (zoneId) filters.push({ laborType: null, zoneId, locationId: null });
  if (laborType && zoneId) filters.push({ laborType, zoneId, locationId: null });
  if (locationId) filters.push({ laborType: null, zoneId: null, locationId });
  if (laborType && locationId) filters.push({ laborType, zoneId: null, locationId });
  return filters;
}

// A row with no requiredTagId always passes; one with it set needs the character's held tags to
// include it. heldTagIds defaults empty, so an unaware caller sees gated rows excluded, not leaked in.
// Pure, so it's unit-tested without a database (db/test/laborDrops.test.js).
function passesRequiredTag(row, heldTagIds = new Set()) {
  return !row.requiredTagId || heldTagIds.has(row.requiredTagId);
}

// Every pool entry across the combined scopes for one roll the character qualifies for, in DB order.
// pickLaborDropOption below is the one that actually draws.
async function laborDropPool(tx, { roll, laborType = null, zoneId = null, locationId = null, heldTagIds = new Set() }) {
  const rows = await tx.laborDropOption.findMany({
    where: { roll, OR: scopeFilters(laborType, zoneId, locationId) },
    include: { tag: { select: { id: true, slug: true, name: true, stackable: true, defaultDurationTurns: true } } },
  });
  return rows.filter((row) => passesRequiredTag(row, heldTagIds));
}

// The faces Laboring (Scavenging) may fall back FROM, and the one it falls back TO. A 1 is
// deliberately not on the list — it's the only face that costs a labourer anything.
const SCAVENGING_FALLBACK_FROM = Object.freeze([4, 5]);
const SCAVENGING_FALLBACK_TO = 6;

// Whether a roll is even a candidate for the fallback below. Pure; whether it FIRES depends on the pool.
function scavengingMayFallBack(roll, heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return held.has(LABORING_SCAVENGING_SLUG) && SCAVENGING_FALLBACK_FROM.includes(roll);
}

// Draws one entry from the combined pool, or null when nothing is configured for this roll (or
// nothing survives the requiredTagId gate). THE DRAW IS TWO-STAGE (db/lib/labordropsRarity.js): land
// on a rarity band, then pick uniformly inside it. A NOTHING row winning is a real result, distinct
// from null. LABORING (SCAVENGING) is the one thing that can redraw: a 4/5 that finds an EMPTY pool
// redraws on the 6. Falling back ONLY from a face that would otherwise pay nothing matters — it can
// never take a configured payout away as more of the table gets filled in.
async function pickLaborDropOption(tx, { roll, laborType = null, zoneId = null, locationId = null, heldTagIds = new Set(), heldSlugs = new Set() }) {
  let pool = await laborDropPool(tx, { roll, laborType, zoneId, locationId, heldTagIds });
  if (pool.length === 0 && scavengingMayFallBack(roll, heldSlugs)) {
    pool = await laborDropPool(tx, {
      roll: SCAVENGING_FALLBACK_TO,
      laborType,
      zoneId,
      locationId,
      heldTagIds,
    });
  }
  if (pool.length === 0) return null;
  return drawFromPool(pool, roll);
}

module.exports = {
  scavengingMayFallBack,
  SCAVENGING_FALLBACK_TO,
  TIER_TO_LABOR_DROP_TYPE,
  scopeFilters,
  passesRequiredTag,
  pickLaborDropOption,
};
