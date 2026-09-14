"use client";

import { useSyncExternalStore } from "react";

// Who is writing something, per place. Same module-store shape as feedStore.js/seenStore.js.
// A typing event is a fact about the next six seconds, not a row. The server never sends
// one for the viewer's own character (web/app/api/feed/route.js), and it holds the
// PRESENTED name — a concealed character types under their alias, the way they speak under it.

// How long one event keeps somebody on the line: long enough to bridge Discord's ~10s
// re-raise and the web composer's 4s throttle, short enough to stop announcing a wanderer.
const LIVE_MS = 6000;

const EMPTY = Object.freeze([]);

// placeKey -> Map<characterId, { name, at }>
const state = { byPlace: new Map(), views: new Map() };
const listeners = new Set();
let sweeper = null;

function emit() {
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Rebuilds one place's frozen name list, sorted by last-heard so it doesn't reshuffle.
function rebuild(placeKey) {
  const live = state.byPlace.get(placeKey);
  const names = live
    ? [...live.values()].sort((a, b) => a.at - b.at).map((entry) => entry.name)
    : [];
  state.views = new Map(state.views);
  state.views.set(placeKey, names.length === 0 ? EMPTY : Object.freeze(names));
}

// Drops aged-out entries and stops itself once nobody is typing, so it can't keep a phone's radio awake.
function sweep() {
  const now = Date.now();
  let changed = false;
  for (const [placeKey, live] of state.byPlace) {
    let dropped = false;
    for (const [characterId, entry] of live) {
      if (now - entry.at < LIVE_MS) continue;
      live.delete(characterId);
      dropped = true;
    }
    if (!dropped) continue;
    if (live.size === 0) state.byPlace.delete(placeKey);
    rebuild(placeKey);
    changed = true;
  }
  if (state.byPlace.size === 0 && sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
  if (changed) emit();
}

function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(sweep, 1000);
  sweeper.unref?.();
}

export function noteTyping({ placeKey, characterId, name }) {
  if (!placeKey || !characterId || !name) return;
  let live = state.byPlace.get(placeKey);
  if (!live) {
    live = new Map();
    state.byPlace.set(placeKey, live);
  }
  live.set(characterId, { name, at: Date.now() });
  rebuild(placeKey);
  startSweeper();
  emit();
}

function getNames(placeKey) {
  return state.views.get(placeKey) ?? EMPTY;
}

function getServerNames() {
  return EMPTY;
}

export function useTyping(placeKey) {
  return useSyncExternalStore(
    subscribe,
    () => (placeKey ? getNames(placeKey) : EMPTY),
    getServerNames,
  );
}

// The sentence itself, so Chat and anything that embeds it read the same.
export function typingLine(names) {
  if (!names || names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}
