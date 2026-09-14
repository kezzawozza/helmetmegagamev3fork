// Restates db/lib/carry.js#rowWeight rather than importing it, which would drag prisma/node:fs into a "use client" bundle.
export function tagWeightLbs(tag, quantity = 1) {
  if (!tag?.tradeable) return 0;
  if (tag.category === "Assets") return 0;
  const each = tag.weightLbs ?? 0;
  if (each <= 0) return 0;
  const n = Math.max(1, Number(quantity) || 1);
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
