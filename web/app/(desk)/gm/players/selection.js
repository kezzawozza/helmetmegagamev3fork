"use client";

import { useSyncExternalStore } from "react";

// Who the desk has open, as client state rather than a route — an RSC
// navigation cannot be cancelled, so `useSelectedLayoutSegment()` made
// switching conversations serialize badly under fast clicks. Selection as a
// store makes a superseded click free. THE URL IS STILL REAL: every change
// writes history.pushState, popstate writes back, so Back/Forward, a pasted
// /gm/players/<id>, ⌘K and audit-log links all still work — the URL follows
// the selection instead of causing it.

const BASE = "/gm/players";

// Read straight from the path, so the first render already knows who is open
// on a cold load and nothing has to sync it in an effect.
function fromPath(pathname) {
  if (!pathname || !pathname.startsWith(`${BASE}/`)) return null;
  const rest = pathname.slice(BASE.length + 1).split("/")[0];
  return rest ? decodeURIComponent(rest) : null;
}

let selected = null;
let started = false;
const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  // Attached on first subscription, not module scope: `window` isn't there when this is evaluated server-side.
  if (!started && typeof window !== "undefined") {
    started = true;
    selected = fromPath(window.location.pathname);
    window.addEventListener("popstate", () => {
      const next = fromPath(window.location.pathname);
      if (next === selected) return;
      selected = next;
      emit();
    });
  }
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  // Seed here too — useSyncExternalStore reads before subscribe runs on first mount.
  if (!started && typeof window !== "undefined") selected = fromPath(window.location.pathname);
  return selected;
}

function getServerSnapshot() {
  // Cannot read window; only covers the hydration pass, getSnapshot takes over immediately after.
  return null;
}

export function useSelection() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Open somebody, or pass null for the roster. `replace` is for landing on a URL rather than choosing from it — must not add a history entry.
export function selectConversation(discordUserId, { replace = false } = {}) {
  const next = discordUserId || null;
  if (next === selected) return;
  selected = next;
  if (typeof window !== "undefined") {
    const url = next ? `${BASE}/${encodeURIComponent(next)}` : BASE;
    // pushState rather than router.push, which would re-enter the navigation
    // this store exists to avoid — only the address bar and store move.
    // State is null, NOT window.history.state: Next's pushState/replaceState
    // patch early-returns on state already carrying its own `__NA` marker, so
    // handing the current state back skips the patch and desyncs
    // canonicalUrl (router.refresh() then refetches the wrong person, Back
    // reloads the whole page). Passing null lets the patch copy __NA and the
    // router's tree onto the new entry — same as Workspace.js on /gm/turns.
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }
  emit();
}
