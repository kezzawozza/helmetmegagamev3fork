// The mining drop die: what a day in the seam can turn up on top of its ⬢
// (docs/systemdocs/MININGDROPS.md). Config lives in MiningDropOption, synced
// from docs/miningdrops.yaml by db/lib/syncMiningDrops.js — this file is the
// reading half. The draw is TWO-STAGE: db/lib/miningdropsRarity.js owns the
// rarity math, this file owns finding the pool. A row may also carry
// requiredTagId, a post-filter gate applied by passesRequiredTag below,
// orthogonal to the SQL-side scopes.
//
// There was a third scope dimension here once — `laborType`, which of the six
// Laboring tiers was working. Mining is the only one left, so the six legal
// scope combinations collapsed to three.
const { drawFromPool } = require("./miningdropsRarity");

// The three legal scope combinations (MININGDROPS.md §2). Never zone AND location together — sync refuses it.
function scopeFilters(zoneId, locationId) {
  const filters = [{ zoneId: null, locationId: null }]; // Global
  if (zoneId) filters.push({ zoneId, locationId: null });
  if (locationId) filters.push({ zoneId: null, locationId });
  return filters;
}

// A row with no requiredTagId always passes; one with it set needs the character's held tags. Default
// empty heldTagIds means an unaware caller sees gated rows excluded, not leaked in.
function passesRequiredTag(row, heldTagIds = new Set()) {
  return !row.requiredTagId || heldTagIds.has(row.requiredTagId);
}

// Every pool entry across the combined scopes for one roll the character qualifies for, in DB order.
async function miningDropPool(tx, { roll, zoneId = null, locationId = null, heldTagIds = new Set() }) {
  const rows = await tx.miningDropOption.findMany({
    where: { roll, OR: scopeFilters(zoneId, locationId) },
    include: { tag: { select: { id: true, slug: true, name: true, stackable: true, defaultDurationTurns: true } } },
  });
  return rows.filter((row) => passesRequiredTag(row, heldTagIds));
}

// Draws one entry from the combined pool, or null when nothing is configured or nothing survives the
// requiredTagId gate. Two-stage draw (db/lib/miningdropsRarity.js): land on a rarity band, then pick
// uniformly inside it. A NOTHING row winning is a real result, distinct from null.
async function pickMiningDropOption(tx, { roll, zoneId = null, locationId = null, heldTagIds = new Set() }) {
  const pool = await miningDropPool(tx, { roll, zoneId, locationId, heldTagIds });
  if (pool.length === 0) return null;
  return drawFromPool(pool, roll);
}

module.exports = {
  scopeFilters,
  passesRequiredTag,
  miningDropPool,
  pickMiningDropOption,
};
