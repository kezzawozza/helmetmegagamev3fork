"use client";

import { useSyncExternalStore } from "react";
import { noteDeskDraftTurn, pruneDeskDrafts } from "./deskDraft";

// The adjudication desk's client-owned model of its own rows — Moves, Caving
// rolls, staged effects/messages. Every action hands back the rows it
// changed and the desk folds them in here, so what a GM sees is what a GM
// did, and the page payload is a reconciliation rather than the only source.
// Module-level state read through useSyncExternalStore, same shape as
// liveInbox.js. Every rebuild makes a new Map/array: react-hooks/immutability is an error here.

const EMPTY_VIEWS = Object.freeze({
  seeded: false,
  moves: Object.freeze([]),
  cavingRolls: Object.freeze([]),
  stagedEffects: Object.freeze([]),
  stagedMessages: Object.freeze([]),
});

// Deleted rows are remembered as tombstones so a page payload already in
// flight can't resurrect them; capped against a long session.
const TOMBSTONE_CAP = 2000;

const state = {
  moves: new Map(),
  caving: new Map(),
  effects: new Map(),
  messages: new Map(),
  turnId: null,
  // Newest asOfMs any payload seeded from — needed because the turn-wipe below is the one decision here that isn't per-row.
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

// The frozen views, readable without React — `useDeskRows` is the ordinary way in.
function deskRowsSnapshot() {
  return state.views;
}

function getSnapshot() {
  return deskRowsSnapshot();
}

function getServerSnapshot() {
  return EMPTY_VIEWS;
}

// THE RECONCILIATION RULE, in one function. Every row carries `asOfMs`, the
// database's own clock at read time (web/lib/pgClock.js). A newer read
// replaces a held row WHOLE, never field by field — mixing halves of two
// reads can say things neither read said. A tie keeps what is held.
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

// The id tiebreaker keeps rows created in the same millisecond stable, so a re-fold never reshuffles the rail under a GM's cursor.
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

// Rebuilt only when something moved, so a component reading it via
// useSyncExternalStore re-renders exactly then. Sort matches page.js's
// queries: Moves/Caving rolls newest first, staged rows oldest first (queue order = push order).
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
// at its own `asOfMs`: a row it doesn't name, no older than the payload, is
// gone (somebody else's Reject/Delete). A row held from a LATER read
// survives. Called on every payload, stored and fresh alike (web/lib/snapshot).
export function seedDesk(payload) {
  if (!payload || !Number.isFinite(payload.asOfMs)) return;
  // A new turn opened under the desk — a different queue, so drop it rather than reconciling.
  const older = payload.asOfMs < state.seededAsOfMs;
  if (payload.turnId !== state.turnId && !older) {
    state.moves = new Map();
    state.caving = new Map();
    state.effects = new Map();
    state.messages = new Map();
    state.turnId = payload.turnId ?? null;
  }
  if (!older) state.seededAsOfMs = payload.asOfMs;
  // New drafts stamped with the desk's current turn (deskDraft.js).
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

  // A page payload is authoritative about membership, so it's the one place
  // that can say a draft's row is gone (deskDraft.js#pruneDeskDrafts). An
  // OLDER payload has no membership authority — letting it prune would delete whatever the GM had open.
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

// What a server action hands back: the rows it touched and the ids it
// removed. NO membership authority — a patch says "these changed", never
// "and nothing else exists". Shape:
//
//   { asOfMs, turnId, moves, cavingRolls, stagedEffects, stagedMessages,
//     removed: { moveIds, cavingRollIds, stagedEffectIds, stagedMessageIds } }
export function applyDeskPatch(patch) {
  if (!patch || !Number.isFinite(patch.asOfMs)) return;
  // THE TURN GATE (deskRows.js#deskPatchFor): a Solve landing across the
  // turn-end push could hold a row from the turn that just closed — a patch
  // for a turn this desk isn't showing has nothing to say to it. Only once
  // seeded: before that, dropping the first frames is worse than folding them in.
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
