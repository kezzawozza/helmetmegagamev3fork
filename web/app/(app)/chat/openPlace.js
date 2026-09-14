"use client";

import { useSyncExternalStore } from "react";

// Which place is open in Chat, per tab — the module store that is the source
// of truth for the URL hash (CHAT.md §5). Same shape as typingStore.js:
// module state, useSyncExternalStore, no provider, never a setState in an effect.

const LAST_KEY = "bascinet:play:last-place";

let current = null;
let seeded = false;
const listeners = new Set();

function readHash() {
  try {
    const raw = window.location.hash.slice(1);
    return raw ? decodeURIComponent(raw) : null;
  } catch {
    return null;
  }
}

function readLast() {
  try {
    return window.localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function remember(key) {
  try {
    window.localStorage.setItem(LAST_KEY, key);
  } catch {
    // A private window forgets; the hash still carries the place this session.
  }
}

// Read on EVERY snapshot: a ⌘K navigation writes the hash after Chat's first
// render and router.push never fires hashchange, so a changed hash is
// adopted here. An absent hash says nothing — the last-open place stands.
function seed() {
  const fromHash = readHash();
  if (fromHash && fromHash !== current) {
    current = fromHash;
    remember(fromHash);
    seeded = true;
    return;
  }
  if (seeded) return;
  seeded = true;
  current = readLast();
}

function emit() {
  for (const cb of listeners) cb();
}

// Back/Forward and an in-page `/chat#…` anchor. An EMPTY hash closes the
// room (Chat falls back to the street), but the last place stays remembered.
function onHashChange() {
  const key = readHash();
  if (key === (current ?? "") || (!key && current === null)) return;
  if (key) {
    current = key;
    remember(key);
  } else {
    current = null;
  }
  emit();
}

function onWorkerMessage(event) {
  const key = event?.data?.openPlace;
  if (typeof key !== "string" || !key) return;
  setOpenPlace(key);
}

// Listeners attach while subscribed, come down with the last subscriber —
// two Chats in one tab (a hot reload) don't fight over them.
function subscribe(cb) {
  if (listeners.size === 0) {
    window.addEventListener("hashchange", onHashChange);
    navigator.serviceWorker?.addEventListener?.("message", onWorkerMessage);
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      window.removeEventListener("hashchange", onHashChange);
      navigator.serviceWorker?.removeEventListener?.("message", onWorkerMessage);
    }
  };
}

function getSnapshot() {
  seed();
  return current;
}

function getServerSnapshot() {
  return null;
}

export function useOpenPlace() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Opens a place. Uses history.pushState (not `location.hash =`) so Next's
// patched pushState keeps its own URL copy in step; Back fires hashchange.
export function setOpenPlace(key) {
  if (!key || typeof key !== "string") return;
  seed();
  const changed = key !== current;
  current = key;
  remember(key);
  if (typeof window !== "undefined" && readHash() !== key) {
    try {
      window.history.pushState(null, "", `#${encodeURIComponent(key)}`);
    } catch {
      // A browser that refuses pushState still has the store; only the
      // address bar is a step behind.
    }
  }
  if (changed) emit();
}
