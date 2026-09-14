"use client";

import { useCallback, useSyncExternalStore } from "react";

// Which tab of the right-hand column this browser had open.
//
// The column used to be five panels stacked down one scroller — the place and
// its prose, who is here, the room, the ways out, and you — which meant the
// tallest thing on the page decided how far you scrolled to reach the rest of
// it, and the column's height changed on every move. They are tabs now, and
// which one you left open is a per-viewer convenience: it belongs in
// localStorage, read through useSyncExternalStore the way seenStore.js and
// useChimeMuted.js do, never in an effect (react-hooks/set-state-in-effect is
// an error in this repo).
//
// Every read and write is wrapped. A private window, blocked site data or a
// thumbnail capture can throw on the accessor itself, and a column that opens
// on its first tab is a perfectly good column.

const KEY = "chat:aside-tab";
const listeners = new Set();

// The snapshot has to be a stable string between changes, or
// useSyncExternalStore spins. Cached, and thrown away only on a write from
// this tab or a storage event from another.
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

// The server renders no stored preference, so the first paint is always the
// first tab and the browser corrects it on hydration. Returning anything else
// here would be a hydration mismatch.
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

/**
 * The remembered tab, or `fallback` when there is nothing stored — or when
 * what IS stored names a tab this place does not have. A room you had open
 * yesterday is not a room you have open now, so the id is checked against
 * what is actually on offer rather than trusted.
 *
 * @param {string[]} available ids this column is drawing, in order
 * @param {string} fallback the tab to open when the stored one is no good
 */
export function useAsideTab(available, fallback) {
  const stored = useSyncExternalStore(subscribe, read, readServer);
  const open = available.includes(stored) ? stored : fallback;
  return [open, useCallback((id) => setAsideTab(id), [])];
}
