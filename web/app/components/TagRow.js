"use client";

import TagDetails from "./TagDetails";
import TagMarks from "./TagMarks";
import TagIcon from "./TagIcon";

// One tag as a line in the rail: the category's colour rule on the left, the
// group's icon, the name, a stack count, and a right-aligned value the card
// chose — turns left, pounds, the armour word, a carry bonus
// (web/lib/sheetCards.js#rowValue).
// A note under the name is the card's second line (Health's "→ Festering ·
// cure …"). Clicking the row opens the tag's full details inline beneath it,
// the same block TagChip shows on hover elsewhere. No hover, no tooltip.
//
// `verbs` renders beside the value: RowVerbs, or nothing.
export default function TagRow({
  ct,
  value = null,
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
    <li className="sheet-row" data-open={open ? "true" : undefined}>
      <div className="sheet-row-line">
        <button
          type="button"
          className="sheet-row-face"
          aria-expanded={open}
          onClick={onToggle}
          data-tag-category={category ?? undefined}
        >
          <span className="sheet-row-name">
            <TagIcon tag={tag} size={12} />
            {tag.name}
            {stack && <span className="text-muted"> ×{stack}</span>}
            {/* The shared state vocabulary (TagMarks.js) — spelled out here
                rather than glyphed, because a row has the width for it. */}
            <TagMarks worn={worn} poison={Boolean(ct.poisonMarker)} />
          </span>
          {note && <span className="sheet-row-note">{note}</span>}
        </button>
        {verbs}
        {value && (
          <span className="sheet-row-value mono" data-tone={value.tone ?? undefined}>
            {value.text}
          </span>
        )}
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
            // Not inside the row's <button> — this detail sits in a sibling
            // div, so a nested {tag:…} reference here can safely become a
            // real, hoverable TagChip instead of flat text (ChipText.js).
            inTooltip
            // "· smells wrong" (M4) — already a stripped, gated boolean by
            // the time it reaches here (character/page.js).
            poisonMarker={Boolean(ct.poisonMarker)}
          />
        </div>
      )}
    </li>
  );
}
