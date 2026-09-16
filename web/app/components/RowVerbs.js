"use client";

// The verbs a pocket row offers, as small labelled buttons: Use, Equip or
// Unequip, Give, Destroy — Heal on a wound, and Research on the Scholastic's
// own skill row (docs/systemdocs/CRAFTING.md §2b). Every one opens the SAME
// dialog the Actions strip opens, through RequestActionsProvider with the tag
// already picked, or flips the same equip toggle; nothing here has a rule of
// its own, and each is re-checked server-side when pressed.
//
// Visible text, no tooltips: this surface has none (SHEET.md). Drawn on hover
// or focus on a pointer device (globals.css). On a touch one it is not on the
// line at all — TagRow.js renders it inside the row's opened details, and says
// why.
export default function RowVerbs({ verbs, pending = false, onUse, onEquip, onGive, onDestroy, onHeal, onResearch }) {
  const items = [];
  if (verbs.consumable && onUse) items.push(["use", "Use", onUse]);
  if (verbs.equippable && onEquip) items.push(["equip", verbs.equipped ? "Unequip" : "Equip", onEquip]);
  if (verbs.tradeable && onGive) items.push(["give", "Give", onGive]);
  if (verbs.removable && onDestroy) items.push(["destroy", "Destroy", onDestroy]);
  if (verbs.healable && onHeal) items.push(["heal", "Heal", onHeal]);
  // Only when every gate is already open — the row's own note carries the
  // reason when one is shut, rather than a dead button (TagRail.js).
  if (verbs.researchable && onResearch) items.push(["research", "Research", onResearch]);
  if (items.length === 0) return null;
  return (
    <span className="sheet-row-verbs">
      {items.map(([key, label, onClick]) => (
        <button key={key} type="button" className="menu-item" disabled={pending} onClick={onClick}>
          {label}
        </button>
      ))}
    </span>
  );
}
