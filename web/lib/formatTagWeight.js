// What one of these weighs, for TagChip's hover panel and the GM's tag sheet. Restates
// db/lib/carry.js#rowWeight rather than importing it, which would drag prisma/node:fs into a
// "use client" bundle. actions/MoveThingsDialog.js inlines the same Assets rule; change both together.
// Weighs nothing: Assets, anything untradeable, and the weightless half of the catalog.

// What a stack of these weighs in pounds, 0 for anything the rules above exempt.
export function tagWeightLbs(tag, quantity = 1) {
  if (!tag?.tradeable) return 0;
  if (tag.category === "Assets") return 0;
  const each = tag.weightLbs ?? 0;
  if (each <= 0) return 0;
  const n = Math.max(1, Number(quantity) || 1);
  // Weights are authored to one decimal, so round the product rather than let
  // float noise show "3.0000000000000004 lb" — same guard carryWeight uses.
  return Math.round(each * n * 100) / 100;
}

export function formatTagWeight(tag, quantity = 1) {
  const total = tagWeightLbs(tag, quantity);
  if (total <= 0) return null;
  const each = tag.weightLbs ?? 0;
  const n = Math.max(1, Number(quantity) || 1);
  if (n === 1) return `${each} lb`;
  return `${each} lb each · ${total} lb`;
}
