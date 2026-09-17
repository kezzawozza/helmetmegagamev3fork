"use client";

import { useSyncExternalStore } from "react";

// The phone, for the map. 640px rather than the shell's 720 because that is
// where the `@media (max-width: 640px)` block in globals.css turns the card
// from a column beside the board into a sheet over it — the two have to agree
// about which shape is on screen, or the CSS draws a sheet while the component
// is still filling a column.
//
// Same six lines as chat/useNarrow.js and components/useIsCoarsePointer.js: a
// media query is exactly the external mutable value useSyncExternalStore is
// for. The server snapshot is false, so the first paint is the desktop shape
// and the client corrects it in the same frame it hydrates.
const QUERY = "(max-width: 640px)";

function subscribe(callback) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

export default function useMapNarrow() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
