"use client";

// Up and down, for a list a GM orders by hand. The arrows are ▲/▼ rather than
// words because the whole control has to fit in a table cell beside the rest
// of a row's actions; `aria-label` is what carries the meaning, since a
// triangle reads as nothing at all out loud.
export default function ReorderButtons({ label, disabled, first, last, onUp, onDown }) {
  return (
    <>
      <button
        type="button"
        className="btn-quiet"
        aria-label={`Move ${label} up`}
        disabled={disabled || first}
        onClick={onUp}
      >
        ▲
      </button>
      <button
        type="button"
        className="btn-quiet"
        aria-label={`Move ${label} down`}
        disabled={disabled || last}
        onClick={onDown}
      >
        ▼
      </button>
    </>
  );
}
