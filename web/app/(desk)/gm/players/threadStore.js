"use client";

import { useCallback, useSyncExternalStore } from "react";

// The conversations this tab has loaded, keyed by discordUserId. Distinct
// from liveInbox.js#feeds, which holds only what ARRIVED SINCE the desk
// loaded and is unioned over this page. Caching is the point — reopening a
// conversation costs nothing. Bounded, since a GM's evening could otherwise
// hold every conversation in memory; least-recently-opened is evicted first,
// the open one never is.

const CAP = 25;

const state = {
  // discordUserId -> { status, payload, error, at }
  //   status: "loading" | "ready" | "error"
  //   payload: the /api/gm/thread body — header fields plus messages/hasMore
  byUser: new Map(),
  snapshot: new Map(),
};

const listeners = new Set();

function emit() {
  // New Map each time: react-hooks/immutability, and a mutated Map wouldn't re-render anyway.
  state.snapshot = new Map(state.byUser);
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const EMPTY = new Map();

function evict(keep) {
  if (state.byUser.size <= CAP) return;
  const entries = [...state.byUser.entries()]
    .filter(([id]) => id !== keep)
    .sort((a, b) => a[1].at - b[1].at);
  let over = state.byUser.size - CAP;
  for (const [id] of entries) {
    if (over <= 0) break;
    state.byUser.delete(id);
    over -= 1;
  }
}

export function getThread(discordUserId) {
  return state.byUser.get(discordUserId) ?? null;
}

export function noteLoading(discordUserId) {
  const had = state.byUser.get(discordUserId);
  // Keep a payload we already have while refetching — same trick web/lib/snapshot plays for a whole page.
  state.byUser.set(discordUserId, {
    status: "loading",
    payload: had?.payload ?? null,
    error: null,
    at: Date.now(),
  });
  evict(discordUserId);
  emit();
}

export function noteReady(discordUserId, payload) {
  state.byUser.set(discordUserId, { status: "ready", payload, error: null, at: Date.now() });
  evict(discordUserId);
  emit();
}

export function noteError(discordUserId, error) {
  const had = state.byUser.get(discordUserId);
  state.byUser.set(discordUserId, {
    status: "error",
    payload: had?.payload ?? null,
    error: error ?? "Something went wrong.",
    at: Date.now(),
  });
  emit();
}

function getSnapshot() {
  return state.snapshot;
}
function getServerSnapshot() {
  return EMPTY;
}

export function useThread(discordUserId) {
  const read = useCallback(
    () => (discordUserId ? (getSnapshot().get(discordUserId) ?? null) : null),
    [discordUserId],
  );
  return useSyncExternalStore(subscribe, read, () => null);
}
