"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { reportDeskReset } from "./blackBox";

// What a GM has typed into a desk row but not yet saved — the Move desk's
// Result box and Kind switch, and the Caving desk's Result box; both used to
// hold this in bare useState, so a hard navigation or error boundary lost it.
// Same shape as dmDraft.js: MEMORY is the source of truth, localStorage a
// best-effort mirror, never the other way round. Keyed by row ("move:<id>" /
// "caving:<id>"); DRAFT WINS over the saved row while it exists (every save,
// solve, reject, resolve clears its own key). Each draft is stamped with its
// turn and last-touched time, so it can be pruned on turn rollover or when
// its row leaves the desk (pruneDeskDrafts, via seedDesk), stops holding the
// backstop poll down after DRAFT_FRESH_MS untouched, and only buffers live
// stream frames while an editor holding it is actually MOUNTED.

const DRAFT_FRESH_MS = 10 * 60 * 1000;

// key -> { value, turnId, writtenAt } | null. `null` is a memoised miss.
const drafts = new Map();
// key -> number of mounted editors. See deskDraftHeld.
const mounts = new Map();
// Once per key per page life: re-opening the same row a dozen times is one
// fact, and a line that repeats is a line nobody reads (blackBox.js).
const reportedDrafts = new Set();
const listeners = new Set();
let currentTurnId = null;

const PREFIX = "gm-desk-draft-";

function storageKey(key) {
  return `${PREFIX}${key}`;
}

function emit() {
  for (const callback of listeners) callback();
}

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// Exported for DeskStream.js, which buffers a live frame for a row somebody is
// mid-sentence in and drains it when the draft clears — the draft map IS the
// desk's record of which rows are dirty, keyed unlike useDirtyGuard's global counter.
export const subscribeToDeskDrafts = subscribe;

// Whether a row is holding unsaved text right now AND somebody has it open —
// the mount test stops the stream buffering frames forever for an abandoned draft.
export function deskDraftHeld(key) {
  if (!(mounts.get(key) > 0)) return false;
  return readDeskDraft(key) != null;
}

// Whether the draft on `key` was touched recently enough to count as somebody
// actively writing. Read by the editors for useDirtyGuard's poll gate.
export function deskDraftFresh(key, nowMs = Date.now()) {
  const entry = readDeskEntry(key);
  if (!entry) return false;
  return nowMs - (entry.writtenAt ?? 0) < DRAFT_FRESH_MS;
}

// Seeded from storage ONCE per key, re-read only on another tab's `storage` event. A refusal or bad JSON memoises null.
function readDeskEntry(key) {
  if (!key) return null;
  const held = drafts.get(key);
  if (held !== undefined) return held;
  let stored = null;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (raw) stored = normalise(JSON.parse(raw));
  } catch {
    /* private window, blocked site data, or a half-written value */
  }
  drafts.set(key, stored);
  return stored;
}

// A stored blob from before the stamps existed is still read, just counted as written at the epoch (stale, unpinned to any turn).
function normalise(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.value && typeof raw.value === "object" && "writtenAt" in raw) {
    return { value: raw.value, turnId: raw.turnId ?? null, writtenAt: Number(raw.writtenAt) || 0 };
  }
  return { value: raw, turnId: null, writtenAt: 0 };
}

// Returns the held draft, or null when the row's own saved values are what
// the editor should show.
function readDeskDraft(key) {
  return readDeskEntry(key)?.value ?? null;
}

// Notify FIRST, mirror second — a throwing setItem can't swallow the
// re-render.
export function writeDeskDraft(key, value) {
  if (!key) return;
  const entry = value ? { value, turnId: currentTurnId, writtenAt: Date.now() } : null;
  drafts.set(key, entry);
  emit();
  try {
    if (entry) window.localStorage.setItem(storageKey(key), JSON.stringify(entry));
    else window.localStorage.removeItem(storageKey(key));
  } catch {
    // Full, private, or blocked; the draft still survives in memory for this tab.
  }
}

export function clearDeskDraft(key) {
  writeDeskDraft(key, null);
}

// Which turn new drafts belong to. Set from seedDesk, so a draft written on
// the desk is stamped with the turn the desk was showing when it was written.
export function noteDeskDraftTurn(turnId) {
  currentTurnId = turnId ?? null;
}

// Drop every stored draft the desk can no longer account for: wrong turn, or
// row no longer on the desk. Called from seedDesk, which knows both answers.
// Walks localStorage rather than the memo, since that's the accumulating case.
export function pruneDeskDrafts(liveKeys) {
  let stored = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const raw = window.localStorage.key(i);
      if (raw?.startsWith(PREFIX)) stored.push(raw.slice(PREFIX.length));
    }
  } catch {
    stored = [];
  }
  let changed = false;
  for (const key of new Set([...stored, ...drafts.keys()])) {
    const entry = readDeskEntry(key);
    if (!entry) continue;
    // A draft with no turn stamp is judged on membership alone.
    const wrongTurn = entry.turnId != null && entry.turnId !== currentTurnId;
    if (!wrongTurn && liveKeys.has(key)) continue;
    // Never sweep a row somebody has open and typed into — it goes when the panel closes.
    if (deskDraftHeld(key)) continue;
    drafts.set(key, null);
    changed = true;
    try {
      window.localStorage.removeItem(storageKey(key));
    } catch {
      /* blocked; the memo miss above is what this tab will read anyway */
    }
  }
  if (changed) emit();
}

// Another tab wrote or cleared a draft; invalidate rather than patch the
// memo, so the next read goes to storage — without this two open desks each
// held their own idea of the same Result box until one reloaded.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    // A null key is localStorage.clear().
    if (event.key == null) {
      drafts.clear();
      emit();
      return;
    }
    if (!event.key.startsWith(PREFIX)) return;
    drafts.delete(event.key.slice(PREFIX.length));
    emit();
  });
}

// Returns the held draft, or null. Mounting also registers this key as OPEN,
// which is what lets the live stream tell "writing here" from "left words here once".
export function useDeskDraft(key) {
  const get = useCallback(() => readDeskDraft(key), [key]);
  useEffect(() => {
    if (!key) return undefined;
    mounts.set(key, (mounts.get(key) ?? 0) + 1);
    // A panel opening onto unsaved text means something took it mid-sentence. Worth one line (blackBox.js).
    if (readDeskDraft(key) != null && !reportedDrafts.has(key)) {
      reportedDrafts.add(key);
      reportDeskReset(`draft restored on ${key}`);
    }
    emit();
    return () => {
      const next = (mounts.get(key) ?? 1) - 1;
      if (next > 0) mounts.set(key, next);
      else mounts.delete(key);
      // A frame the stream buffered while this editor was open can land now.
      emit();
    };
  }, [key]);
  return useSyncExternalStore(subscribe, get, getServerSnapshot);
}

function getServerSnapshot() {
  return null;
}
