"use client";

import { useCallback, useSyncExternalStore } from "react";

// Which tab of the right-hand column this browser had open — a per-viewer localStorage
// convenience, read through useSyncExternalStore, never in an effect (react-hooks/set-state-in-effect
// is an error in this repo). Every read and write is wrapped against a throwing accessor.

const KEY = "chat:aside-tab";
const listeners = new Set();

// The snapshot must be stable between changes or useSyncExternalStore spins.
let cached = null;

function invalidate() {
  cached = null;
}

function emit() {
  invalidate();
  for (const cb of listeners) cb();
}

function subscribe(callback) {
  // Another tab may have moved it since this one last looked.
  invalidate();
  listeners.add(callback);
  const onStorage = (event) => {
    if (event.key !== null && event.key !== KEY) return;
    invalidate();
    callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function read() {
  if (cached === null) {
    try {
      cached = window.localStorage.getItem(KEY) ?? "";
    } catch {
      cached = "";
    }
  }
  return cached;
}

// The server renders no stored preference; returning anything else here would be a hydration mismatch.
function readServer() {
  return "";
}

function setAsideTab(id) {
  try {
    window.localStorage.setItem(KEY, String(id));
  } catch {
    // Nothing to do: the column still works, it just forgets.
  }
  emit();
}

// The remembered tab, or `fallback` when there is nothing stored, or when what IS stored
// names a tab this place does not have — checked against what is actually on offer.
export function useAsideTab(available, fallback) {
  const stored = useSyncExternalStore(subscribe, read, readServer);
  const open = available.includes(stored) ? stored : fallback;
  return [open, useCallback((id) => setAsideTab(id), [])];
}
