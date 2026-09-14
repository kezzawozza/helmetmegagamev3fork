const { LABORING_SCAVENGING_SLUG } = require("./constants");
// The labor drop die: what a Labor payout can find, on top of its ⬢. See
// docs/systemdocs/LABORDROPS.md.
//
// The config lives in the database (LaborDropOption), synced from
// docs/labordrops.yaml by db/lib/syncLaborDrops.js. This file is the reading
// half: given a roll and the three scopes a payout happened under, it finds
// every entry that answers to them and draws one.
//
// The draw is TWO-STAGE, the shape db/lib/cavingLoot.js has always had: land
// on a rarity band by the die face's column, then pick evenly among that
// band's members. db/lib/labordropsRarity.js owns the columns and the
// arithmetic; this file owns finding the pool.
//
// It used to be uniform over the concatenated pool, with repetition as the
// only way to weight anything. That cost three things — nothing could be
// rarer than 1/poolsize, every bucket needed its own `nothing` pad or
// stacking raised the wound rate, and a local table diluted the global one.
// labordropsRarity.js's header has the full account.
//
// A row may ALSO carry requiredTagId, a seventh gate orthogonal to the six
// scopes — "only in this combined pool for a character who holds this tag
// too" (Forester in the Forest is the first user). It is not part of the SQL
// WHERE, because "does the drawing character hold tag X" cannot be expressed
// against a query keyed on their zone/location/laborType alone — it is a
// post-filter over whatever the six scopes already matched, applied by
// passesRequiredTag below.

// db/lib/laborAccess.js#resolveLaborRateFrom's own tier strings. "refining"
// has no entry — the Godard Factory pays in goods, not a die (FACTORY.md),
// and db/lib/moveEffects.js's laborDrop effect skips it before this is ever
// called.
const { drawFromPool } = require("./labordropsRarity");

const TIER_TO_LABOR_DROP_TYPE = {
  basic: "BASIC",
  skilled: "SKILLED",
  hunting: "HUNTING",
  farming: "FARMING",
  fishing: "FISHING",
  prospecting: "PROSPECTING",
};

// The six legal scope combinations a pool can be authored under (LABORDROPS.md
// §2). Never zone AND location together — that combination isn't one of the
// six the design calls for, and the sync refuses to write it.
function scopeFilters(laborType, zoneId, locationId) {
  const filters = [{ laborType: null, zoneId: null, locationId: null }]; // Global
  if (laborType) filters.push({ laborType, zoneId: null, locationId: null });
  if (zoneId) filters.push({ laborType: null, zoneId, locationId: null });
  if (laborType && zoneId) filters.push({ laborType, zoneId, locationId: null });
  if (locationId) filters.push({ laborType: null, zoneId: null, locationId });
  if (laborType && locationId) filters.push({ laborType, zoneId: null, locationId });
  return filters;
}

// A row with no requiredTagId always passes. One with it set needs the
// drawing character's held tag ids to include it — heldTagIds defaults to
// empty, so a caller that doesn't know what a character holds (or genuinely
// holds nothing) correctly sees every gated row excluded rather than
// leaking in. Pure, so it's unit-tested without a database
// (db/test/laborDrops.test.js).
function passesRequiredTag(row, heldTagIds = new Set()) {
  return !row.requiredTagId || heldTagIds.has(row.requiredTagId);
}

// Every pool entry across the combined scopes for one roll that the drawing
// character actually qualifies for (requiredTagId included), in DB order —
// callers that just want the whole pool (a preview, a test) can use this
// directly; pickLaborDropOption below is the one that actually draws.
async function laborDropPool(tx, { roll, laborType = null, zoneId = null, locationId = null, heldTagIds = new Set() }) {
  const rows = await tx.laborDropOption.findMany({
    where: { roll, OR: scopeFilters(laborType, zoneId, locationId) },
    include: { tag: { select: { id: true, slug: true, name: true, stackable: true, defaultDurationTurns: true } } },
  });
  return rows.filter((row) => passesRequiredTag(row, heldTagIds));
}

// The faces Laboring (Scavenging) may fall back FROM, and the one it falls back
// TO. A 1 is deliberately not on the list: the tag says a GOOD day is never an
// injury, not that a bad one stops happening, and moving 1 as well would delete
// the only face that costs a labourer anything.
const SCAVENGING_FALLBACK_FROM = Object.freeze([4, 5]);
const SCAVENGING_FALLBACK_TO = 6;

// Whether a Scavenger's roll is even a candidate for the fallback below. Pure,
// so the rule is testable without a database; whether it actually FIRES depends
// on the pool, which only pickLaborDropOption can see.
function scavengingMayFallBack(roll, heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return held.has(LABORING_SCAVENGING_SLUG) && SCAVENGING_FALLBACK_FROM.includes(roll);
}

// Draws one entry from the combined pool, or null when nothing is
// configured for this roll at all (or nothing in it survives the
// requiredTagId gate) — which is the deliberate default while most of the
// table is still unbuilt.
//
// THE DRAW IS TWO-STAGE now (db/lib/labordropsRarity.js): land on a rarity
// band, then pick uniformly inside it. A NOTHING row winning is a real
// result and not the same as returning null — the caller distinguishes "the
// die was rolled and gave nothing" from "there was no table to roll on".
//
// LABORING (SCAVENGING) is the one thing that can redraw. A 4 or a 5 that finds
// an EMPTY pool is drawn again on the 6's instead, which is what "drops on 4
// and 5 as well as 6" means for a table where those faces hold nothing.
//
// The empty-pool test is the whole point, and it is not a detail. This started
// life as a blanket 4/5 -> 6 remap, written when faces 1 and 6 were the only
// ones configured anywhere. Prospecting (2026-09-19) filled in 2, 4 and 5, and
// a blanket remap immediately became a DOWNGRADE: a fisherman's 4 is worth
// 10 ⬢ against face 6's 1.56, and a prospector's 5 is worth 8 against 6.75.
// Falling back only from a face that would otherwise pay nothing can never take
// a configured payout away, and it needs no per-face bookkeeping to stay true
// as the rest of the table gets built out.
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
