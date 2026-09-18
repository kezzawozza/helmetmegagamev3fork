"use client";

import { useRef } from "react";

// One number and its label. The label is the word, the value carries the
// glyph (CLAUDE.md house rule for ⬢). A tile with something to say SWAPS ITS
// OWN FACE for it on hover, focus or click, inside the same box at the same
// height — no layout shift, and no tooltip (the sheet has none, SHEET.md
// §3). Click matters as much as hover: a phone has no hover, and focus
// reaches players on a keyboard the same way.
// `tone` colours the value by meaning, the rule StatusPill.js sets. `word` drops the mono face — a word is not data.
// `sub` is the quiet line under the number, always drawn: the coin in your
// pocket beside your ⬢, the mood's own figure, which modifier is on the Gambit.
// It is NOT the `detail` — that swaps the whole face, and only on demand — so a
// tile can carry both, which is what the Mood box does ("−16 · press for why").
//
// Lifted out of LedgerBand.js so the GM desks can wear the same behaviour:
// the inspector's Combat readout and the Move desk's both mount this, and a
// second hand-rolled hover panel would have drifted from this one immediately.
export default function DetailTile({
  label,
  value,
  over = false,
  tone = null,
  word = false,
  sub = null,
  detail = null,
  open = false,
  onOpen = null,
  children = null,
}) {
  // Whether a MOUSE is over this tile: a touch tap fires a synthesised
  // mouseenter before its click, and without this the tap opened then
  // immediately closed the tile. Declared before the early return — a hook may not be called conditionally.
  const hovering = useRef(false);
  // Two classes: `ledger-tile` is the shared name the GM desks style off too
  // (DevBand.js, InspectorColumn.js) — untouched, so their look doesn't move.
  // `tile` is the mockup's own name, added alongside it so this box carries
  // the class the mockup's CSS actually keys on (docs/design/mockups/
  // character/index.html), which sheet.css now targets as well.
  const className = "ledger-tile tile";
  // A detail with nobody listening is a crash waiting for the one caller that
  // forgets. It was a private component with three call sites before; now it
  // is shared, so it absorbs the mistake instead of taking the page down.
  const setOpen = onOpen ?? (() => {});
  if (!detail) {
    return (
      <div className={className}>
        <span className="field-label">{label}</span>
        <span
          className="ledger-tile-value tile-value"
          data-over={over ? "true" : "false"}
          data-tone={tone ?? undefined}
          data-word={word ? "true" : undefined}
        >
          {value}
        </span>
        {sub && <span className="ledger-tile-sub tile-sub">{sub}</span>}
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${className} ledger-tile-button`}
      aria-expanded={open}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        hovering.current = true;
        setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        hovering.current = false;
        setOpen(false);
      }}
      // Under a mouse the tile is already open, so a click would only close it.
      // Touch and keyboard land here with no pointer over the tile — there the click IS the way in and back out.
      onClick={() => {
        if (hovering.current) return;
        setOpen(!open);
      }}
      // :focus-visible so a tap (which also focuses) doesn't fight the click above.
      onFocus={(e) => {
        if (e.target.matches(":focus-visible")) setOpen(true);
      }}
      onBlur={() => setOpen(false)}
    >
      <span className="field-label">{label}</span>
      {/* Both faces live in one relative box, detail ABSOLUTE inside it, so opening a tile can't change its height. `visibility` not `hidden`. */}
      <span className="ledger-tile-faces">
        <span className="ledger-tile-face" data-open={open ? "true" : "false"}>
          <span
            className="ledger-tile-value tile-value"
            data-over={over ? "true" : "false"}
            data-tone={tone ?? undefined}
            data-word={word ? "true" : undefined}
          >
            {value}
          </span>
          {sub && <span className="ledger-tile-sub tile-sub">{sub}</span>}
          {children}
        </span>
        <span className="ledger-tile-detail" data-open={open ? "true" : "false"}>
          {detail}
        </span>
      </span>
    </button>
  );
}
