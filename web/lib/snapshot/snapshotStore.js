"use client";

import { useSyncExternalStore } from "react";

// A page's last-known data, kept in the browser to paint at once on the next visit and refresh
// underneath. Not a cache the server honours or a source of truth — every server action
// re-validates from the database (CLAUDE.md, "A server action is a public endpoint"), so acting
// on a stale sheet is safe. Mirrored to localStorage (docs/systemdocs/CHAT.md §5c).
// Bump VERSION whenever a page's snapshot shape changes, so an old snapshot is ignored rather
// than handed to a renderer that expects the new shape — this changes the storage key prefix,
// orphaning every stored snapshot everywhere at once.
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
    return null;
  }
}

// SnapshotFresh hands the view the same round-tripped shape, so the view sees ONE shape either way.
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
    // page still works, just paints from the server next time
  }
}

// Called on sign-out so a shared browser never shows the next person the last person's sheet.
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
  }
  memory.clear();
  emit();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Never an effect writing state (react-hooks/set-state-in-effect).
export function useSnapshot(scope, userId) {
  return useSyncExternalStore(
    subscribe,
    () => readSnapshot(scope, userId),
    () => null,
  );
}
