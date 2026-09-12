// The labor-drop EV maths, pulled verbatim out of
// db/scripts/ops/audit-labor-drops.js so it can be exercised with a plain
// node --test instead of only by eyeballing the CLI's stdout. See that
// script for what calls this and LABORDROPS.md §6a/§7 for what the numbers
// mean.
const { rowShares } = require("./labordropsRarity");
const { ASSUMED_VALUES } = require("./labordropsAnnotate");

// The one tag that IS ⬢ rather than something sold for it — DEPOT.md: "one
// obol is one ⬢", the physical form of the currency itself (weight 0, no
// sellablePrice of its own because selling an obol for ⬢ is a category
// error). Hardcoded here rather than read off any catalog field, because
// there is no field that says it — the same "known by name" carve-out
// db/lib/lifeweb.js and a handful of others already accept for this repo's
// smallest set of singular concepts.
const OBOL_SLUG = "obol";
const OBOL_VALUE = 1;

// One pool entry -> { label, evValue, note }. evValue is always a ⬢ number
// (0 for NOTHING and for a tag with neither a price nor an override) — see
// the legend the CLI prints at the bottom of its report for why a tag's
// pointCost is shown but never summed into it.
//
// Mirrors labordropsAnnotate.js#mechanicalValue/priceRows exactly — ASSUMED_VALUES
// checked BEFORE the real sellable price (a Lockbox's discounted sellablePrice
// must never win over its full contents value), then consumesIntoResources for
// a non-sellable tag that still pays out when consumed (Purse, Supply Kit).
// This branch order went missing from the script in the 2026-09-10 rarity
// merge — labordropsAnnotate.js kept it (its own tests still pin it), but the
// terminal report silently fell back to 0 ⬢ for every Lockbox and consumable
// until restored here, imported from the one place ASSUMED_VALUES is defined
// rather than re-declared.
function priceEntry(row, tagsById) {
  if (row.kind === "NOTHING") return { label: "(nothing)", evValue: 0, note: null };
  if (row.kind === "RESOURCES") {
    const amount = row.resourceAmount ?? 0;
    return { label: `${amount > 0 ? "+" : ""}${amount} ⬢`, evValue: amount, note: null };
  }
  const tag = tagsById.get(row.tagId);
  const name = tag?.name ?? `(unknown tag ${row.tagId})`;
  if (tag?.slug === OBOL_SLUG) {
    return { label: `${name} — the coin itself, worth ${OBOL_VALUE} ⬢`, evValue: OBOL_VALUE, note: null };
  }
  if (tag && ASSUMED_VALUES[tag.slug] != null) {
    const overrideValue = ASSUMED_VALUES[tag.slug];
    const label =
      tag.sellable && tag.sellablePrice
        ? `${name} — worth ${overrideValue} ⬢ opened (sells ${tag.sellablePrice} ⬢ locked)`
        : `${name} — assumed ${overrideValue} ⬢ (not actually sellable yet)`;
    return { label, evValue: overrideValue, note: tag.sellable ? null : "assumed" };
  }
  if (tag?.sellable && tag.sellablePrice) {
    return { label: `${name} — sells ${tag.sellablePrice} ⬢`, evValue: tag.sellablePrice, note: null };
  }
  if (tag?.consumesIntoResources) {
    return {
      label: `${name} — worth ${tag.consumesIntoResources} ⬢ consumed`,
      evValue: tag.consumesIntoResources,
      note: null,
    };
  }
  const pointNote = tag ? `pointCost ${tag.pointCost}` : "tag missing from catalog";
  return { label: `${name} — not sellable (${pointNote})`, evValue: 0, note: "unpriced" };
}

// Priced by BAND, not by row count: a row's chance comes from the die face's
// rarity column (db/lib/labordropsRarity.js), so `ev` is a real expectation
// and `hit` is the real miss rate. Under the old uniform draw the two
// happened to coincide with "fraction of lines"; they do not any more.
//
// `hits` stays a count because the printout says "N entries" beside it;
// `hit` is the fraction that actually matters.
function summarize(rows, tagsById, roll) {
  const priced = rows.map((r) => priceEntry(r, tagsById));
  const shares = rowShares(rows, roll);
  const hits = priced.filter((p) => p.label !== "(nothing)").length;
  let ev = 0;
  let hit = 0;
  priced.forEach((p, i) => {
    ev += p.evValue * shares[i];
    if (p.label !== "(nothing)") hit += shares[i];
  });
  const unpriced = priced.filter((p) => p.note === "unpriced").length;
  return { priced, hits, hit, ev, unpriced, shares };
}

module.exports = { OBOL_SLUG, OBOL_VALUE, priceEntry, summarize };
