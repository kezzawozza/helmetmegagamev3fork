"use client";

// A set of things you tick, drawn as check rows with a filter over them.
//
// This replaces every <select multiple size={6}> the GM surfaces used to
// carry — one over the whole tag catalog, one over every living character, one
// over the zones — a control with no search, no way to see what you had picked
// without scrolling the box, and no keyboard story worth the name.
//
// It started life as quests/GatePicker.js, whose header said to promote it here
// the moment a fourth call site outside that folder wanted it. Four call sites
// now: the two quest gates, the Dev Panel's people picker, its place picker,
// and /gm/players' bulk composer. What made the promotion possible without the
// `filterDef`/`renderRow`/`selectAllMode` prop soup that comment feared:
//
//   - matching is a `search` FUNCTION the caller passes, not a shape to declare.
//     The default is substring over label + note; a roster passes fuzzy scoring.
//   - a row's second line is the `note` field, which every call site's extra
//     information already fits (a place, a role, a count). No renderRow.
//   - Select all always UNIONS, which is the only honest reading once there is
//     a filter box above it. No mode to pick.
//   - anything else a caller wants beside the filter box goes in `toolbar` —
//     one slot, rather than a prop per control.
//
// `items` is [{ id, label, note? }] and `value` is an array of ids. Controlled
// throughout — every path hands back a NEW array, never a mutated one
// (react-hooks/immutability is an error here), and holding the selection
// internally would break the quest edit pane, where ticking a tag has to dirty
// the draft for Save to light up. web/app/components/usePickList.js is the
// selection state for callers that have none of their own.
import { useId, useMemo, useState } from "react";

import CheckField from "@/app/components/CheckField";
import EmptyState from "@/app/components/EmptyState";

function defaultSearch(item, query) {
  return `${item.label ?? ""} ${item.note ?? ""}`.toLowerCase().includes(query);
}

export default function CheckPicker({
  label,
  items,
  value,
  onChange,
  search = defaultSearch,
  // Anything that belongs beside the filter box — a zone dropdown that narrows
  // `items`, a "check this whole faction" one-shot.
  toolbar,
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
    return items.filter((i) => search(i, q));
  }, [items, query, search]);

  function toggle(itemId) {
    onChange(picked.has(itemId) ? value.filter((v) => v !== itemId) : [...value, itemId]);
  }

  const showFilter = items.length > searchThreshold;

  return (
    <div className="field">
      {label ? (
        <span className="field-label" id={`${id}-label`}>
          {label}
        </span>
      ) : null}

      {showFilter || toolbar ? (
        <div className="flex flex-wrap items-end gap-3">
          {showFilter ? (
            <input
              type="text"
              className="min-w-48 flex-1"
              value={query}
              placeholder={filterPlaceholder}
              aria-label={`Filter ${typeof label === "string" ? label.toLowerCase() : "list"}`}
              onChange={(e) => setQuery(e.target.value)}
            />
          ) : null}
          {toolbar}
        </div>
      ) : null}

      {/* An inline style rather than a Tailwind max-h-*: .check-picker is
          unlayered and Tailwind's utilities live in @layer utilities, so a
          utility would LOSE to the class's own max-height. Same cascade trap
          .panel's comment documents for padding. */}
      <div
        className="check-picker"
        role="group"
        aria-labelledby={label ? `${id}-label` : undefined}
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
