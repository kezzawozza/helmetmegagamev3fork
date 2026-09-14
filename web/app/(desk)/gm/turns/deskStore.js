"use client";

import { useSyncExternalStore } from "react";
import { noteDeskDraftTurn, pruneDeskDrafts } from "./deskDraft";

// The adjudication desk's client-owned model of its own rows — the Moves,
// Caving rolls and staged effects/messages the workspace draws.
//
// Before this, the only truth on /gm/turns was the last RSC payload: a
// mutation wrote to the database, then asked the router to fetch the whole
// page again and hoped the answer came back. When it didn't — a deploy had
// latched the stale gate, or the refresh raced a remount — the write had
// landed and the screen never said so. Now every action hands back the rows it
// changed and the desk folds them in here, so what a GM sees is what a GM did,
// and the page payload is a reconciliation rather than the only source.
//
// Module-level state read through useSyncExternalStore, the same shape as the
// player desk's liveInbox.js — no provider, no library.
//
// Every rebuild makes a new Map/array: react-hooks/immutability is an error
// here.

const EMPTY_VIEWS = Object.freeze({
  seeded: false,
  moves: Object.freeze([]),
  cavingRolls: Object.freeze([]),
  stagedEffects: Object.freeze([]),
  stagedMessages: Object.freeze([]),
});

// Deleted rows are remembered as tombstones so a page payload already in
// flight when the delete happened can't resurrect them. They are only ever
// dropped by a full payload that is newer than the tombstone, so the set has
// to be capped against a long session.
const TOMBSTONE_CAP = 2000;

const state = {
  moves: new Map(),
  caving: new Map(),
  effects: new Map(),
  messages: new Map(),
  turnId: null,
  // The newest asOfMs any payload has been seeded from. The turn-wipe below is
  // the one decision in here that is not per-row, so it is the one that needs
  // its own clock: a STORED snapshot from a previous turn seeds just like a
  // fresh payload does, and without this it could announce last turn's id,
  // empty the queue and take the draft the GM is typing with it.
  seededAsOfMs: -1,
  seeded: false,
  views: EMPTY_VIEWS,
};

const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// The frozen views, readable without React. `useDeskRows` is the ordinary way
// in; this is the same value for anything that is not a component — and it is
// what lets the store's arbitration be exercised on its own.
function deskRowsSnapshot() {
  return state.views;
}

function getSnapshot() {
  return deskRowsSnapshot();
}

function getServerSnapshot() {
  return EMPTY_VIEWS;
}

// THE RECONCILIATION RULE, in one function.
//
// Every row that reaches this store carries `asOfMs`, the database's own clock
// at the moment it was read (web/lib/pgClock.js). A newer read replaces a held
// row WHOLE — never field by field. The fields of one row came from one
// consistent read, and mixing half of a fresh row with half of a stale one can
// say things neither read ever said: a Move marked Solved by a GM who has not
// been recorded as solving it yet.
//
// A tie keeps what is held. Two reads at the same millisecond are the same
// read for our purposes, and churning the object for nothing would re-render
// the desk.
function hold(map, id, row, asOfMs) {
  if (!id) return false;
  const held = map.get(id);
  if (held && held.asOfMs >= asOfMs) return false;
  map.set(id, { row, asOfMs, gone: row == null });
  return true;
}

function capTombstones(map) {
  let gone = 0;
  for (const entry of map.values()) if (entry.gone) gone += 1;
  if (gone <= TOMBSTONE_CAP) return;
  let over = gone - TOMBSTONE_CAP;
  for (const [id, entry] of map) {
    if (!entry.gone) continue;
    map.delete(id);
    over -= 1;
    if (over <= 0) break;
  }
}

function liveRows(map) {
  const out = [];
  for (const entry of map.values()) if (!entry.gone && entry.row) out.push(entry.row);
  return out;
}

// The id tiebreaker keeps two rows created in the same millisecond in one
// stable order, so a re-fold never reshuffles the rail under a GM's cursor.
function byCreatedDesc(a, b) {
  const d = (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0);
  if (d !== 0) return d;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function byCreatedAsc(a, b) {
  const d = (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0);
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Rebuilt only when something actually moved, and frozen, so a component that
// reads it through useSyncExternalStore re-renders exactly when the rows did.
// The sort matches what page.js's queries ask Postgres for: Moves and Caving
// rolls newest first, staged rows oldest first (the order they were queued in
// is the order they will push in).
function rebuildViews() {
  state.views = Object.freeze({
    seeded: state.seeded,
    moves: Object.freeze(liveRows(state.moves).sort(byCreatedDesc)),
    cavingRolls: Object.freeze(liveRows(state.caving).sort(byCreatedDesc)),
    stagedEffects: Object.freeze(liveRows(state.effects).sort(byCreatedAsc)),
    stagedMessages: Object.freeze(liveRows(state.messages).sort(byCreatedAsc)),
  });
}

const TYPES = [
  ["moves", "moves", "moveIds"],
  ["caving", "cavingRolls", "cavingRollIds"],
  ["effects", "stagedEffects", "stagedEffectIds"],
  ["messages", "stagedMessages", "stagedMessageIds"],
];

// A whole page payload. Unlike a patch this is AUTHORITATIVE ABOUT MEMBERSHIP
// at its own `asOfMs`: a row it doesn't name, whose held copy is no older than
// the payload, is gone — somebody else's Reject or Delete, which is exactly
// what the desk needs to learn from a refresh. A row held from a LATER read
// survives, because the payload simply hadn't seen it yet.
//
// Called from an effect on every payload, stored snapshot and fresh alike
// (web/lib/snapshot). The older stored copy folding in after the newer fresh
// one changes nothing — that is the whole reason the desk no longer has to
// remount when the fresh data lands.
export function seedDesk(payload) {
  if (!payload || !Number.isFinite(payload.asOfMs)) return;
  // A new turn opened under the desk. Last turn's queue is not stale data to
  // reconcile, it is a different queue, so drop it rather than letting the
  // tombstone rules argue about it.
  const older = payload.asOfMs < state.seededAsOfMs;
  if (payload.turnId !== state.turnId && !older) {
    state.moves = new Map();
    state.caving = new Map();
    state.effects = new Map();
    state.messages = new Map();
    state.turnId = payload.turnId ?? null;
  }
  if (!older) state.seededAsOfMs = payload.asOfMs;
  // New drafts are stamped with whatever turn the desk is showing, and the
  // prune below judges the old ones against it (deskDraft.js).
  noteDeskDraftTurn(state.turnId);

  const asOfMs = payload.asOfMs;
  let changed = false;

  for (const [key, field] of TYPES) {
    const map = state[key];
    const rows = Array.isArray(payload[field]) ? payload[field] : [];
    const named = new Set();
    for (const row of rows) {
      named.add(row.id);
      if (hold(map, row.id, row, asOfMs)) changed = true;
    }
    for (const [id, entry] of [...map]) {
      if (named.has(id) || entry.asOfMs > asOfMs) continue;
      map.delete(id);
      changed = true;
    }
  }

  // A page payload is authoritative about membership, which makes it the one
  // place that can say a draft's row is gone. Every Move and Caving roll still
  // on the desk is a live draft key; anything else stored under one — last
  // turn's, or a row somebody rejected — is swept (deskDraft.js#pruneDeskDrafts).
  // An OLDER payload has no membership authority — it is a stored snapshot
  // arriving behind the fresh one, and its idea of what is on the desk is a
  // memory. Letting it prune deleted whatever the GM had open.
  if (!older) {
    const liveDraftKeys = new Set();
    for (const row of liveRows(state.moves)) liveDraftKeys.add(`move:${row.id}`);
    for (const row of liveRows(state.caving)) liveDraftKeys.add(`caving:${row.id}`);
    pruneDeskDrafts(liveDraftKeys);
  }

  if (!state.seeded) {
    state.seeded = true;
    changed = true;
  }
  if (changed) {
    rebuildViews();
    emit();
  }
}

// What a server action hands back: the rows it touched and the ids it removed.
// NO membership authority — a patch says "these changed", never "and nothing
// else exists". Shape:
//
//   { asOfMs, turnId, moves, cavingRolls, stagedEffects, stagedMessages,
//     removed: { moveIds, cavingRollIds, stagedEffectIds, stagedMessageIds } }
export function applyDeskPatch(patch) {
  if (!patch || !Number.isFinite(patch.asOfMs)) return;
  // THE TURN GATE. Every patch says which turn the desk it was built for was
  // showing (deskRows.js#deskPatchFor). A mutation asks about rows by id and
  // does not test whether they are still on the desk, so a Solve that lands
  // across the turn-end push comes back holding a row from the turn that just
  // closed — and the store holds rows, not queries, so nothing downstream
  // would catch it dropping into the new turn's queue. A patch for a turn this
  // desk is not showing has nothing to say to it.
  //
  // Only once the desk has been seeded: before that there is no turn to
  // compare against, and dropping the first frames would be worse than folding
  // them in and letting the first payload arbitrate.
  if (state.seeded && patch.turnId !== undefined && (patch.turnId ?? null) !== state.turnId) return;
  const asOfMs = patch.asOfMs;
  let changed = false;

  for (const [key, field, removedField] of TYPES) {
    const map = state[key];
    for (const row of Array.isArray(patch[field]) ? patch[field] : []) {
      if (hold(map, row.id, row, asOfMs)) changed = true;
    }
    for (const id of patch.removed?.[removedField] ?? []) {
      if (hold(map, id, null, asOfMs)) changed = true;
    }
    capTombstones(map);
  }

  if (changed) {
    rebuildViews();
    emit();
  }
}

export function useDeskRows() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
