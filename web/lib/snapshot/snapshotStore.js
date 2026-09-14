"use client";

import { useSyncExternalStore } from "react";

// A page's last-known data, kept in the browser so the page can paint it at
// once on the next visit and refresh underneath. One module store, keyed by
// page scope and account, mirrored to localStorage (docs/systemdocs/CHAT.md
// §5c).
//
// What this is NOT: a cache the server honours, a source of truth, or a
// place a decision is made from. Every server action re-validates from the
// database (CLAUDE.md, "A server action is a public endpoint"), so acting on
// a stale sheet is safe — the fresh data simply replaces it.
//
// Bump VERSION whenever a page's snapshot shape changes. An old snapshot is
// then ignored rather than handed to a renderer that expects the new shape.
//
// Bumped 2026-09-12: the Chat rail's tag chips (7dd5f2c2, "The chat rail's
// chips are real tag chips now") reshaped the `things`/tag-chip payload
// FreshChat stores for /chat without bumping this, so a browser holding an
// older Chat snapshot painted it straight into the new ChatView and threw —
// on every load, forever, since the stale copy lives in that browser's own
// localStorage and no redeploy touches it. Bumping VERSION changes the
// storage key prefix, so every stored snapshot everywhere is orphaned at
// once: the next load finds nothing under the new prefix, falls through to
// the fresh server fetch, and simply looks like a first visit.
const VERSION = 2;
const PREFIX = `bascinet:snap:${VERSION}:`;

// localStorage is ~5MB per origin. One page may not eat most of it.
const MAX_BYTES_PER_SCOPE = 1_500_000;

const memory = new Map();
const listeners = new Set();

function keyFor(scope, userId) {
  return `${PREFIX}${userId}:${scope}`;
}

function emit() {
  for (const cb of listeners) cb();
}

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Thumbnail capture and some privacy settings throw on the accessor.
    return null;
  }
}

// Dates and BigInts do not survive JSON. The snapshot always holds the JSON
// shape, and SnapshotFresh hands the view the same round-tripped shape, so
// the view sees ONE shape whether it painted from the snapshot or from the
// server.
function replacer(_key, value) {
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function roundTrip(data) {
  return JSON.parse(JSON.stringify(data, replacer));
}

function readSnapshot(scope, userId) {
  if (!userId) return null;
  const key = keyFor(scope, userId);
  if (memory.has(key)) return memory.get(key);
  const store = storage();
  if (!store) return null;
  let parsed = null;
  try {
    const raw = store.getItem(key);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  memory.set(key, parsed);
  return parsed;
}

export function writeSnapshot(scope, userId, data) {
  if (!userId) return;
  const key = keyFor(scope, userId);
  memory.set(key, data);
  emit();
  const store = storage();
  if (!store) return;
  try {
    const raw = JSON.stringify(data, replacer);
    if (raw.length > MAX_BYTES_PER_SCOPE) {
      store.removeItem(key);
      return;
    }
    store.setItem(key, raw);
  } catch {
    // Quota, private mode, a blocked accessor — the page still works, it
    // just paints from the server next time.
  }
}

// Every snapshot, every account, every version. Called when there is no
// signed-in account on the page (sign-out lands on the public layout), so a
// shared browser never shows the next person the last person's sheet.
export function clearSnapshots() {
  const store = storage();
  if (!store) return;
  try {
    const doomed = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith("bascinet:snap:")) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch {
    // Same.
  }
  memory.clear();
  emit();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// The server has no snapshot, so SSR and the hydration pass draw the
// fallback; React re-renders with the stored one right after, before paint
// settles. Never an effect writing state (react-hooks/set-state-in-effect).
export function useSnapshot(scope, userId) {
  return useSyncExternalStore(
    subscribe,
    () => readSnapshot(scope, userId),
    () => null,
  );
}
