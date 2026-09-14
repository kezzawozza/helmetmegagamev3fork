"use client";

import { useSyncExternalStore } from "react";

// How far this reader has read in each place, per browser. localStorage via
// useSyncExternalStore, never in an effect (react-hooks/set-state-in-effect is an error here).
// The old name survives in the key: renaming it would forget every player's seen marks.
const PREFIX = "hall:seen:";
const listeners = new Set();

function emit() {
  invalidate();
  for (const cb of listeners) cb();
}

// Cached, invalidated only on emit or a storage event — avoids walking every localStorage key on every render.
let cached = null;

function invalidate() {
  cached = null;
}

function subscribe(callback) {
  // Another tab may have moved a mark since the last visit.
  invalidate();
  listeners.add(callback);
  const onStorage = () => {
    invalidate();
    callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function scan() {
  const parts = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      parts.push(`${key.slice(PREFIX.length)}=${window.localStorage.getItem(key)}`);
    }
  } catch {
    return "";
  }
  return parts.sort().join("|");
}

// One string for the whole map, so useSyncExternalStore's snapshot stays stable between renders.
function read() {
  if (cached === null) cached = scan();
  return cached;
}

function readServer() {
  return "";
}

// Memoised on the string, so the column's props hold still between changes.
let parsedFor = null;
let parsedMap = new Map();

function parse(snapshot) {
  if (snapshot === parsedFor) return parsedMap;
  const map = new Map();
  if (snapshot) {
    for (const part of snapshot.split("|")) {
      const at = part.lastIndexOf("=");
      if (at <= 0) continue;
      map.set(part.slice(0, at), part.slice(at + 1));
    }
  }
  parsedFor = snapshot;
  parsedMap = map;
  return map;
}

// Only moves forward: a stale write must not re-mark a room as unread.
export function markSeen(placeKey, seq) {
  if (!placeKey || !seq) return;
  try {
    const current = window.localStorage.getItem(`${PREFIX}${placeKey}`);
    if (current && BigInt(current) >= BigInt(seq)) return;
    window.localStorage.setItem(`${PREFIX}${placeKey}`, String(seq));
  } catch {
    return;
  }
  // The storage event does not fire in the tab that wrote it.
  emit();
}

// The mark RIGHT NOW, outside the store — the NEW divider needs it a beat before markSeen moves it.
export function peekSeen(placeKey) {
  if (!placeKey) return null;
  try {
    return window.localStorage.getItem(`${PREFIX}${placeKey}`);
  } catch {
    return null;
  }
}

// A first visit starts caught up (every place marked at what was newest on
// load) instead of lighting up every place at once — only on an empty slate.
export function seedSeenIfFresh(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      if (window.localStorage.key(i)?.startsWith(PREFIX)) return;
    }
  } catch {
    return;
  }
  markAllSeen(entries);
}

// Same write as seedSeenIfFresh without its empty-slate guard. FORWARD ONLY
// per place, same rule as markSeen; one emit at the end, not one per place.
export function markAllSeen(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  let wrote = false;
  try {
    for (const entry of entries) {
      if (!entry?.placeKey || !entry.seq) continue;
      const key = `${PREFIX}${entry.placeKey}`;
      const current = window.localStorage.getItem(key);
      try {
        if (current && BigInt(current) >= BigInt(entry.seq)) continue;
      } catch {
        // An unparseable mark from an older build: overwrite it.
      }
      window.localStorage.setItem(key, String(entry.seq));
      wrote = true;
    }
  } catch {
    return;
  }
  if (wrote) emit();
}

export function useSeen() {
  const snapshot = useSyncExternalStore(subscribe, read, readServer);
  return parse(snapshot);
}

// Compared as BigInt: a seq is a bigint column and "9" sorts after "10" as a string.
export function isUnread(seen, placeKey, newest) {
  if (!newest) return false;
  const mark = seen.get(placeKey);
  if (!mark) return true;
  try {
    return BigInt(newest) > BigInt(mark);
  } catch {
    return false;
  }
}
