// What one held row weighs, in pounds. The single answer, shared by the
// server's carry maths (db/lib/carry.js) and by the browser's readouts
// (web/lib/formatTagWeight.js, web/app/(app)/chat/thingRows.js).
//
// ZERO REQUIRES, EVER — the same discipline db/lib/dmPolicy.js and
// db/lib/armorValue.js keep, and for the same reason: a "use client" module
// imports this by path, and one require of @lifeweb/db here would drag
// PrismaClient into the browser bundle. db/lib/carry.js cannot serve that
// role however pure its top half looks; it reaches Discord and Prisma through
// ./dm and ./tagWrites.
//
// It lived in three places before this and the three disagreed: carry.js
// compared Tag.category raw, the chat drawer folded it through
// canonicalCategory, and formatTagWeight.js compared raw AND rounded. A row
// whose category read "assets" was therefore weightless in the drawer and
// weighty on the server — the kind of split that shows up as a carry meter
// nobody can reconcile.

// The category whose tags never weigh on your back. An arelitz carries itself, a
// cart rolls, a house does not move at all. Tag.category holds the DISPLAY
// name rather than the YAML slug (db/lib/syncTags.js), but the compare is
// case-folded: until the 2026-09-26 backfill the catalog genuinely held both
// "Assets" and "assets", and a future minter that slips the same way should
// weigh nothing rather than silently start weighing something.
const WEIGHTLESS_CATEGORY = "assets";

// Unrounded, so a caller summing many rows rounds once at the end rather than
// accumulating per-row rounding error.
function tagWeightLbs(tag, quantity = 1) {
  // Untradeable is part of you rather than cargo (a graft in your neck), and
  // so are skills, injuries and statuses, which carry no weight anyway.
  if (!tag?.tradeable) return 0;
  if (String(tag.category ?? "").toLowerCase() === WEIGHTLESS_CATEGORY) return 0;
  const each = tag.weightLbs ?? 0;
  if (each <= 0) return 0;
  return each * Math.max(1, Number(quantity) || 1);
}

// The CharacterTag-shaped form, which is how the server holds a row.
function rowWeight(ct) {
  return tagWeightLbs(ct?.tag, ct?.quantity ?? 1);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { WEIGHTLESS_CATEGORY, tagWeightLbs, rowWeight, round2 };
