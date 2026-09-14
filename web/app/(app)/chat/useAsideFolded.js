"use client";

import { useSyncExternalStore } from "react";

// The breakpoint at which the right column folds into the ⋯ sheet: 900px, matching the `56.25rem` media block in
// globals.css — CSS hides the column, this hook decides which one MOUNTS, so they must agree or there'd be a band
// with neither. Chat.js renders only ONE off this hook to avoid double-mounting (two TravelNodes loads, etc).
// Mirrors useIsCoarsePointer.js: a media query is the external value useSyncExternalStore is for; reading it in an
// effect would be a frame late and a react-hooks/set-state-in-effect error. Server snapshot is false (desktop shape).
const QUERY = "(max-width: 56.25rem)";

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

export default function useAsideFolded() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
