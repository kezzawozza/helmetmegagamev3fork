// Where a held tag sits, for the Items table's "Where" column
// (docs/design/mockups/character/index.html: "pack", "body, Over", "head",
// "held", "ride"). Reuses equipSlots.js's own slot titles and layer names
// rather than writing them out again, so a slot that gains a layer says so
// here too, the same reasoning EquipBoard.js's row hint already leans on.
//
// A leaf, zero-Prisma import (the submodule path, not the @lifeweb/db
// barrel) — safe to call from a client component (ARCHITECTURE.md §2).
import { LAYER_NAMES, SLOT_TITLES } from "@lifeweb/db/lib/equipSlots";

export function itemWhere(ct) {
  const tag = ct.tag;
  const out = ct.equippedQuantity ?? (ct.equipped ? 1 : 0);
  if (!out || !tag?.equipSlot) return "pack";
  const slot = tag.equipSlot;
  const title = (SLOT_TITLES[slot] ?? slot).toLowerCase();
  const layers = LAYER_NAMES[slot];
  const layer = tag.equipLayer;
  if (layers && Number.isInteger(layer) && layer >= 1 && layer <= layers.length) {
    return `${title}, ${layers[layer - 1]}`;
  }
  return title;
}
