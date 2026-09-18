// The mining-drop EV maths, pulled out of db/scripts/ops/audit-mining-drops.js
// so it's testable with node --test. See that script for callers and
// MININGDROPS.md §6a/§7 for what the numbers mean.
const { rowShares } = require("./miningdropsRarity");
const { ASSUMED_VALUES } = require("./miningdropsAnnotate");

// The one tag that IS ⬢ (DEPOT.md: "one obol is one ⬢"), no sellablePrice of
// its own since selling an obol for ⬢ is a category error. Hardcoded — no
// catalog field says it, the same "known by name" carve-out db/lib/lifeweb.js accepts.
const OBOL_SLUG = "obol";
const OBOL_VALUE = 1;

// One pool entry -> { label, evValue, note }. evValue is always a ⬢ number
// (0 for NOTHING or an unpriced tag). Mirrors
// miningdropsAnnotate.js#mechanicalValue/priceRows exactly — ASSUMED_VALUES
// checked BEFORE the real sellable price (a Lockbox's discounted
// sellablePrice must never win over its full contents value), then
// consumesIntoResources for a non-sellable tag that pays out when consumed
// (Purse, Supply Kit). Keep this branch order in sync with miningdropsAnnotate.js.
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

// Priced by BAND, not row count: a row's chance comes from the die face's
// rarity column (miningdropsRarity.js), so `ev`/`hit` are real expectations,
// not "fraction of lines" as under the old uniform draw. `hits` stays a count
// for the printout's "N entries"; `hit` is the fraction that matters.
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
