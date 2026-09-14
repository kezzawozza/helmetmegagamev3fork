"use client";

import { useCallback, useSyncExternalStore } from "react";

// A small sessionStorage-backed value, one key at a time (usePins.js's
// localStorage pattern): read through useSyncExternalStore
// (react-hooks/set-state-in-effect is an error in this repo), JSON-encoded.
// Per-tab view state that dies with the tab but survives a same-tab reload.

const listeners = new Map(); // key -> Set<callback>
const cache = new Map(); // key -> { raw, value }

function subscribers(key) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  return set;
}

function parse(raw, fallback) {
  try {
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// getSnapshot must return the SAME reference until the value changes, or a fresh parse is an infinite render loop.
function read(key, fallback) {
  try {
    const raw = window.sessionStorage.getItem(key);
    const cached = cache.get(key);
    if (cached && cached.raw === raw) return cached.value;
    const value = parse(raw, fallback);
    cache.set(key, { raw, value });
    return value;
  } catch {
    return cache.get(key)?.value ?? fallback;
  }
}

function write(key, value) {
  const raw = JSON.stringify(value);
  try {
    window.sessionStorage.setItem(key, raw);
  } catch {
    /* private window / blocked site data — in-memory cache still updates below. */
  }
  cache.set(key, { raw, value });
  for (const callback of subscribers(key)) callback();
}

// Plain, unsubscribed door to the store, for state too high-frequency for
// React state. readSession during render is only hydration-safe if the value doesn't shape hydrated output.
export function readSession(key, fallback) {
  return read(key, fallback);
}

export function writeSession(key, value) {
  write(key, value);
}

// `fallback` doubles as server snapshot AND pre-write value — pass a stable reference.
export default function useSessionState(key, fallback) {
  const subscribe = useCallback(
    (callback) => {
      const set = subscribers(key);
      set.add(callback);
      return () => set.delete(callback);
    },
    [key],
  );
  const getSnapshot = useCallback(() => read(key, fallback), [key, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (updater) => {
      const current = read(key, fallback);
      const next = typeof updater === "function" ? updater(current) : updater;
      write(key, next);
    },
    [key, fallback],
  );

  return [value, setValue];
}
