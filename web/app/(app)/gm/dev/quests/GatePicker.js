"use client";

// A set of things you tick, drawn as check rows with a filter over them.
//
// This replaces two <select multiple size={6}> — one over the whole tag
// catalog, one over every living character — which is the control
// (desk)/gm/dev/BulkActions.js was written to get rid of: no search, no way to
// see what you had picked without scrolling the box, and no keyboard story
// worth the name.
//
// Local to quests/ rather than components/, on purpose. BulkActions' picker
// looks the same and isn't: it carries a zone dropdown, its rows draw a second
// place line, and its Select all UNIONS with what is already picked because it
// is filtered by zone as well as by text. Sharing one component with both
// would mean a `filterDef` prop, a `renderRow` prop and a `selectAllMode`
// prop, which is a worse component than two honest ones. The rule, so this
// doesn't drift: the moment a FOURTH call site outside this folder wants it,
// move it to web/app/components/ and convert BulkActions in the same pass.
//
// `items` is [{ id, label, note? }] and `value` is an array of ids. Controlled
// throughout — every path hands back a NEW array, never a mutated one
// (react-hooks/immutability is an error here), and holding the selection
// internally would break the edit pane, where ticking a tag has to dirty the
// draft for Save to light up.
import { useId, useMemo, useState } from "react";

import CheckField from "@/app/components/CheckField";
import EmptyState from "@/app/components/EmptyState";

export default function GatePicker({
  label,
  items,
  value,
  onChange,
  emptyLabel = "Nothing matches.",
  allLabel = "Select all",
  filterPlaceholder = "Filter…",
  // A six-zone list does not need a filter box above it.
  searchThreshold = 8,
  maxHeight,
  // Paired side by side, two boxes of different content lengths read as a
  // broken layout rather than two lists. Given a floor they read as a pair.
  minHeight,
}) {
  const id = useId();
  const [query, setQuery] = useState("");

  const picked = useMemo(() => new Set(value), [value]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.label} ${i.note ?? ""}`.toLowerCase().includes(q));
  }, [items, query]);

  function toggle(itemId) {
    onChange(picked.has(itemId) ? value.filter((v) => v !== itemId) : [...value, itemId]);
  }

  return (
    <div className="field">
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>

      {items.length > searchThreshold ? (
        <input
          type="text"
          value={query}
          placeholder={filterPlaceholder}
          aria-label={`Filter ${typeof label === "string" ? label.toLowerCase() : "list"}`}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}

      {/* An inline style rather than a Tailwind max-h-*: .check-picker is
          unlayered and Tailwind's utilities live in @layer utilities, so a
          utility would LOSE to the class's own max-height. Same cascade trap
          .panel's comment documents for padding. */}
      <div
        className="check-picker"
        role="group"
        aria-labelledby={`${id}-label`}
        style={maxHeight || minHeight ? { maxHeight, minHeight } : undefined}
      >
        {visible.map((i) => (
          <CheckField key={i.id} checked={picked.has(i.id)} onChange={() => toggle(i.id)}>
            <span className="flex flex-wrap items-baseline gap-2">
              <span>{i.label}</span>
              {i.note ? <span className="text-xs text-muted">{i.note}</span> : null}
            </span>
          </CheckField>
        ))}
        {visible.length === 0 ? <EmptyState>{emptyLabel}</EmptyState> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Unions with what is already picked, so filtering to "rope" and
            pressing this does not silently drop everything else. */}
        <button
          type="button"
          className="btn-quiet"
          onClick={() => onChange([...new Set([...value, ...visible.map((i) => i.id)])])}
        >
          {allLabel}
        </button>
        <button type="button" className="btn-quiet" onClick={() => onChange([])}>
          Clear
        </button>
        <span className="mono text-sm text-muted">
          {value.length} of {items.length} picked
        </span>
      </div>
    </div>
  );
}
