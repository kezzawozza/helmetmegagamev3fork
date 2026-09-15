"use client";

import TagDetails from "./TagDetails";
import TagMarks from "./TagMarks";
import TagIcon from "./TagIcon";

// One held item as a CARD rather than a line — the Items and Assets rails
// (web/lib/sheetCards.js#INVENTORY_CARDS). Everything else on the sheet keeps
// TagRow's single line.
//
// The difference is what it is allowed to say. A row shows one right-hand
// value chosen by rowValue(), which is first-match-wins and therefore lossy
// by construction: a stack of five 2 lb rations reads "10 lb" and never that
// there are five, and an armoured coat never mentions its armour because it
// happens to weigh something. An inventory is the one place that trade is
// wrong — a player packing for a fight wants the weight AND the count AND the
// armour at once — so a card takes sheetCards.js#itemFacts, which returns all
// of them, and prints the lot.
//
// Everything else is deliberately the same as a row: the category rule, the
// group icon, the shared state marks, the same verbs, and the same
// TagDetails opening inline on click. A card is a denser row, not a new
// language.
export default function ItemCard({
  ct,
  facts = [],
  note = null,
  verbs = null,
  open = false,
  onToggle,
  currentTurn = null,
  armedTurn = null,
  worn = false,
}) {
  const tag = ct.tag;
  const stack = (ct.quantity ?? 1) > 1 ? ct.quantity : null;
  const category = tag.category ? String(tag.category).toLowerCase() : null;

  return (
    <li className="item-card" data-open={open ? "true" : undefined}>
      <div className="item-card-line">
        <button
          type="button"
          className="item-card-face"
          aria-expanded={open}
          onClick={onToggle}
          data-tag-category={category ?? undefined}
        >
          <span className="item-card-name">
            <TagIcon tag={tag} size={13} />
            {tag.name}
            {stack && <span className="text-muted"> ×{stack}</span>}
            <TagMarks worn={worn} poison={Boolean(ct.poisonMarker)} />
          </span>
          {/* The facts, in reading order, separated rather than tabulated: a
              card holding two facts should not leave four empty columns. mono
              because they are nearly all numbers (DESIGN-SYSTEM.md). */}
          {facts.length > 0 && (
            <span className="item-card-facts mono">
              {facts.map((f, i) => (
                <span key={f.key} data-tone={f.tone ?? undefined}>
                  {i > 0 && <span className="item-card-sep"> · </span>}
                  {f.text}
                </span>
              ))}
            </span>
          )}
          {note && <span className="sheet-row-note">{note}</span>}
        </button>
        {verbs}
      </div>
      {open && (
        <div className="sheet-row-details">
          <TagDetails
            tag={tag}
            quantity={ct.quantity ?? 1}
            expiresTurn={ct.expiresTurn}
            currentTurn={currentTurn}
            armedTurn={armedTurn}
            showName={false}
            // Not inside the card's <button> — this sits in a sibling div, so
            // a nested {tag:…} reference can safely become a real hoverable
            // TagChip instead of flat text (ChipText.js).
            inTooltip
            poisonMarker={Boolean(ct.poisonMarker)}
          />
        </div>
      )}
    </li>
  );
}
