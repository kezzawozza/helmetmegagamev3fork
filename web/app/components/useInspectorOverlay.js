"use client";

import useSessionState from "./useSessionState";

// Whether the inspector column is showing, on the narrow tiers where it is an
// overlay rather than a third column (globals.css, "the inspector becomes an
// overlay"). Above ~1024px the column is always there and this value is not
// read at all.
//
// One key for both GM desks on purpose. The inspector is the same column
// wearing two hosts (/gm/turns' Workspace and /gm/players' InspectorHost), a
// GM who opened it on one desk means it open on the other, and sessionStorage
// through useSessionState is already how every other piece of desk view state
// is held — per tab, dead with the tab, alive across the reload every deploy
// triggers.
const INSPECTOR_OVERLAY_KEY = "gm-desk-inspector";

// A module constant, so useSyncExternalStore never sees the fallback change
// identity (useSessionState.js says the same).
const DEFAULT = { open: false };

export default function useInspectorOverlay() {
  const [state, setState] = useSessionState(INSPECTOR_OVERLAY_KEY, DEFAULT);
  const open = Boolean(state?.open);
  const setOpen = (next) =>
    setState((s) => ({ ...s, open: typeof next === "function" ? next(Boolean(s?.open)) : Boolean(next) }));
  return { open, setOpen };
}

// The header's door to it. Rendered on both desks; CSS hides it on the wide
// tier, where there is nothing to toggle.
export function InspectorToggle() {
  const { open, setOpen } = useInspectorOverlay();
  return (
    <button
      type="button"
      className="btn-quiet desk-inspector-toggle"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      Inspector
    </button>
  );
}
