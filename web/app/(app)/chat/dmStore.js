"use client";

import { useSyncExternalStore } from "react";

// The Bascinet conversation's store — kept the way feedStore.js keeps the
// scene: module-level state read through useSyncExternalStore. Rows are keyed
// by the row's own id, not a seq (DirectMessage has none); the pane refetches
// on open and after a reconnect (CHAT.md §2b). Every rebuild makes a new
// array — react-hooks/immutability is an error in this repo.

const EMPTY = Object.freeze([]);

const state = {
  byId: new Map(), // id -> row: { id, direction, content, source, createdAt, meta }
  rows: EMPTY, // frozen, ascending by createdAt then id
  seeded: false, // whether the pane has loaded its first page
  hasMore: false,
  // Newest thing Bascinet said, epoch ms — what the unread dot compares
  // against (seenStore.js). Seeded from the page so the dot is right before the pane ever opens.
  newestOutboundMs: null,
  reconnects: 0, // bumped on EventSource reconnect, so the pane refetches
  snapshot: null, // rebuilt on every change, never mutated
};

const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function byTime(a, b) {
  const x = Date.parse(a.createdAt);
  const y = Date.parse(b.createdAt);
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rebuild() {
  state.rows = Object.freeze([...state.byId.values()].sort(byTime));
  for (const row of state.rows) {
    if (row.direction !== "OUTBOUND") continue;
    const ms = Date.parse(row.createdAt);
    if (Number.isFinite(ms) && (state.newestOutboundMs === null || ms > state.newestOutboundMs)) {
      state.newestOutboundMs = ms;
    }
  }
  state.snapshot = Object.freeze({
    rows: state.rows,
    seeded: state.seeded,
    hasMore: state.hasMore,
    newestOutboundMs: state.newestOutboundMs,
    reconnects: state.reconnects,
  });
}

// read() below rebuilds WITHOUT telling anybody — it runs during a render, and notifying from there is what React warns about.
function commit() {
  rebuild();
  emit();
}

const SERVER_SNAPSHOT = Object.freeze({
  rows: EMPTY,
  seeded: false,
  hasMore: false,
  newestOutboundMs: null,
  reconnects: 0,
});

function read() {
  if (!state.snapshot) rebuild();
  return state.snapshot;
}

function readServer() {
  return SERVER_SNAPSHOT;
}

export function useDmState() {
  return useSyncExternalStore(subscribe, read, readServer);
}

// Only ever moves the number forward.
export function seedNewestOutbound(ms) {
  if (ms === null || ms === undefined) return;
  const n = Number(ms);
  if (!Number.isFinite(n)) return;
  if (state.newestOutboundMs !== null && state.newestOutboundMs >= n) return;
  state.newestOutboundMs = n;
  // Called from Chat.js's state INITIALIZER, during a render before anyone has subscribed, so no notify needed.
  rebuild();
}

// The first page, or a fresh copy after a reconnect. Already-held rows stay.
export function seedDmRows(rows, hasMore) {
  for (const row of rows ?? []) if (row?.id) state.byId.set(row.id, row);
  state.seeded = true;
  state.hasMore = Boolean(hasMore);
  commit();
}

// An older page, from the sentinel at the top of the thread.
export function prependDmRows(rows, hasMore) {
  for (const row of rows ?? []) if (row?.id) state.byId.set(row.id, row);
  state.hasMore = Boolean(hasMore);
  commit();
}

// The same id twice is a no-op, so the stream and the action racing each other is harmless.
export function addDmRow(row) {
  if (!row?.id) return;
  const had = state.byId.get(row.id);
  if (had && had.content === row.content) return;
  state.byId.set(row.id, row);
  commit();
}

export function noteDmReconnect() {
  state.reconnects += 1;
  commit();
}
