"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setVisibleZonesAction } from "@/app/(desk)/gm/zoneViewActions";
import { useSetVisibleZoneNames } from "@/app/components/GmZoneViewProvider";

// Burst of clicks settles into one write, not four.
const SETTLE_MS = 350;

// The zone multiselect at the bottom of the inspector on both GM desks. Sets
// which rows the desk shows AND which "GM: <Zone>" Discord roles the GM
// holds. Nothing selected means every zone (web/lib/gmZoneView.js) — "All" is
// the empty set. Nothing here waits on the server: local state paints on the
// click, Discord role grants land later in the action's after().
// Keyed on the selection so the inner rail remounts only when the server's
// answer actually changes — needed because three pages carrying this rail
// are snapshotted (web/lib/snapshot) and would otherwise show a stale chip.
// Can't be done from inside — a component can't key itself.
// `onSaved` fires once the server has CONFIRMED a new selection, for a surface
// whose own list is server-rendered and cannot re-filter from client state the
// way the desks do — /chat's left column is the one (GmAside.js). The desks
// pass nothing and behave exactly as before.
export default function GmZoneRail({ zones, selectedIds, onSaved }) {
  return (
    <ZoneChips
      key={(selectedIds ?? []).join(",")}
      zones={zones}
      selectedIds={selectedIds}
      onSaved={onSaved}
    />
  );
}

function ZoneChips({ zones, selectedIds, onSaved }) {
  const [selected, setSelected] = useState(() => new Set(selectedIds ?? []));
  const [error, setError] = useState(null);
  const publish = useSetVisibleZoneNames();

  // Last selection the server confirmed; a failed write rolls back to THIS, not whatever's on screen.
  const confirmed = useRef(new Set(selectedIds ?? []));
  const latest = useRef(selected);
  const timer = useRef(null);

  const flush = useCallback(async () => {
    const next = latest.current;
    const result = await setVisibleZonesAction([...next]);
    if (result?.ok) {
      confirmed.current = next;
      // Only publish if nothing newer was clicked since, or this stale answer fights the latest click.
      if (latest.current === next) {
        publish?.(result.zoneNames ?? null);
        onSaved?.();
      }
      setError(null);
      return;
    }
    latest.current = confirmed.current;
    setSelected(confirmed.current);
    setError(result?.error ?? "Couldn't save that.");
  }, [publish, onSaved]);

  const commit = (next) => {
    setSelected(next);
    setError(null);
    latest.current = next;
    // Paint immediately off the names we already hold; the server only confirms.
    publish?.(
      next.size > 0 ? zones.filter((z) => next.has(z.id)).map((z) => z.name) : null,
    );
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SETTLE_MS);
  };

  useEffect(() => () => timer.current && clearTimeout(timer.current), []);

  const toggle = (zoneId) => {
    const next = new Set(selected);
    if (next.has(zoneId)) next.delete(zoneId);
    else next.add(zoneId);
    commit(next);
  };

  const all = selected.size === 0;

  return (
    <div className="desk-inspector-zones">
      <span className="field-label">Zones I see</span>
      <div className="chip-row" role="group" aria-label="Zones I see">
        <button
          type="button"
          className="chip"
          data-active={all || undefined}
          aria-pressed={all}
          onClick={() => commit(new Set())}
        >
          All
        </button>
        {zones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className="chip"
            data-active={selected.has(zone.id) || undefined}
            aria-pressed={selected.has(zone.id)}
            onClick={() => toggle(zone.id)}
          >
            {zone.name}
          </button>
        ))}
      </div>
      {error && <p className="form-error text-xs">{error}</p>}
    </div>
  );
}
