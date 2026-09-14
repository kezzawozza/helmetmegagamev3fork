"use client";

import ChipPicker from "./ChipPicker";

// The cooking bench (docs/systemdocs/COOKING.md): ordered ingredient slots (this file) over
// a pantry borrowed from ChipPicker's row. The cook is told the TASTE and nothing else —
// web/lib/referenceData.js#cookedTasteOnly cuts the block before it reaches a browser. A
// greyed chip is a hint — resolveIngredientSlots re-checks server-side.

export default function IngredientSlots({
  min = 0,
  max = 1,
  // [{ slug, name, taste, held }] — everything the cook is carrying that
  // carries a `cooked` block, already narrowed by the caller.
  options = [],
  // The slugs slotted so far, in order.
  value = [],
  onChange,
  // How many of each the batch will spend, so a stack of one cannot fill two
  // meals' worth of a slot.
  quantity = 1,
}) {
  const picked = Array.isArray(value) ? value : [];
  const bySlug = new Map(options.map((o) => [o.slug, o]));
  const full = picked.length >= max;

  return (
    <>
      <div className="slot-row">
        {Array.from({ length: max }, (_, i) => {
          const slug = picked[i];
          const ing = slug ? bySlug.get(slug) : null;
          const required = i < min;
          if (!ing) {
            return (
              <div
                key={i}
                className="slot"
                data-required={required ? "true" : undefined}
                // The first empty slot is where the next chip lands.
                data-next={i === picked.length ? "true" : undefined}
              >
                <span className="slot-tag">{required ? "Needed" : "Optional"}</span>
                <span className="slot-empty">—</span>
              </div>
            );
          }
          return (
            <div key={i} className="slot" data-filled="true">
              <button
                type="button"
                className="slot-clear"
                onClick={() => onChange(picked.filter((_, n) => n !== i))}
                aria-label={`Take out ${ing.name}`}
              >
                ✕
              </button>
              <span className="slot-tag">{ing.name}</span>
              {ing.taste ? <span className="slot-taste">{ing.taste}</span> : null}
            </div>
          );
        })}
      </div>

      {/* Bounded: the row scrolls inside its own box rather than pushing the slots and
          the Craft button off the bottom of the modal. */}
      <div className="pantry">
      <ChipPicker
        options={options.map((o) => ({
          id: o.slug,
          label: o.name,
          note: `×${o.held}`,
          // Slotted chips read as chosen AND refuse a second click.
          active: picked.includes(o.slug),
          disabled: picked.includes(o.slug) || o.held < quantity || full,
        }))}
        value=""
        onChange={(slug) => {
          if (slug && !full && !picked.includes(slug)) onChange([...picked, slug]);
        }}
        emptyLabel="You don't have any ingredients."
      />
      </div>
    </>
  );
}
