"use client";

import { createContext, useContext, useMemo, useState } from "react";

// Which zones the viewing GM has chosen, held in the CLIENT so toggling one re-filters the desk immediately
// (avoids waiting on a full desk refetch). Server is still the source of truth, seeded from
// web/lib/gmZoneView.js#getVisibleZones. NULL MEANS EVERY ZONE, never an empty list, matching inVisibleZones in
// web/lib/zones.js — callers branch on null rather than length.
const GmZoneViewContext = createContext(null);

export function GmZoneViewProvider({ initialZoneNames, children }) {
  const [zoneNames, setZoneNames] = useState(initialZoneNames ?? null);
  const value = useMemo(() => ({ zoneNames, setZoneNames }), [zoneNames]);
  return <GmZoneViewContext.Provider value={value}>{children}</GmZoneViewContext.Provider>;
}

// The names of the zones in view, or null for all of them. `fallback` is the server prop the caller already had,
// so a table rendered outside a provider keeps working rather than throwing.
export function useVisibleZoneNames(fallback = null) {
  const ctx = useContext(GmZoneViewContext);
  return ctx ? ctx.zoneNames : (fallback ?? null);
}

// The rail's half: how the picker publishes a new selection.
export function useSetVisibleZoneNames() {
  const ctx = useContext(GmZoneViewContext);
  return ctx?.setZoneNames ?? null;
}
