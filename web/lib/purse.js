// The physical coin, counted off a held-tag list. One obol is one ⬢
// (DEPOT.md §0) — parity, not identity — so it is a separate count from
// `resourcesOf` rather than folded into it. Zero-require, like
// formatTagWeight.js, so both the sheet's band (LedgerBand.js) and the chat
// aside's you-frame can call the one copy from a client component.

// The coin's slug, spelled here the way character/actions/crafting.js spells
// it — there is no constant for it in db/lib, and a client component may not
// reach the @lifeweb/db barrel to look for one.
const OBOL_SLUG = "obol";

export function obolsOf(character) {
  return (character?.tags ?? []).reduce(
    (n, ct) => (((ct?.tag?.slug ?? ct?.slug) === OBOL_SLUG) ? n + (ct.quantity ?? 1) : n),
    0,
  );
}
