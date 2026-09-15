// The browser's weight readouts. The rule itself is db/lib/tagWeight.js —
// zero-require on purpose, so importing it here cannot drag Prisma into the
// client bundle the way db/lib/carry.js would. This file only formats.
import { tagWeightLbs as rawWeight, round2 } from "@lifeweb/db/lib/tagWeight";

export function tagWeightLbs(tag, quantity = 1) {
  return round2(rawWeight(tag, quantity));
}

export function formatTagWeight(tag, quantity = 1) {
  const total = tagWeightLbs(tag, quantity);
  if (total <= 0) return null;
  const each = tag.weightLbs ?? 0;
  const n = Math.max(1, Number(quantity) || 1);
  if (n === 1) return `${each} lb`;
  return `${each} lb each · ${total} lb`;
}
