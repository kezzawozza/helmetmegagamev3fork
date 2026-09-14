"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { reportDeskReset } from "./blackBox";

// What a GM has typed into a desk row but not yet saved — the Move desk's
// Result box and Kind switch, and the Caving desk's Result box.
//
// Those two were the last editors on either desk in no storage tier at all.
// Everything else a GM types is held somewhere: the reply box has dmDraft.js,
// the rail's view state has useSessionState.js, the rows themselves have
// deskStore.js. The Result box had useState and nothing else, so anything
// that replaced the column — a deploy-window hard navigation, an error
// boundary, a stray reload — took the narration with it.
//
// Same shape as dmDraft.js, and for the same reason: MEMORY is the source of
// truth and localStorage is a best-effort mirror, never the other way round.
// A full quota makes setItem throw, and a store that read back from storage
// would freeze the GM's typing mid-sentence.
//
// Keyed by row: "move:<id>" and "caving:<id>". A draft is a whole object (the
// Move desk edits two fields together), replaced wholesale on every write, so
// useSyncExternalStore's identity check is satisfied by the stored reference.
//
// The DRAFT WINS over the row while it exists. Clearing it is what hands the
// editor back to the saved value, so every save, solve, reject and resolve
// clears its own key.
//
// A DRAFT IS NOT FOREVER. It used to be: written once, kept until something
// cleared it, and until then counted as unsaved work by everything that asks.
// A week-old draft nobody was looking at stood the 120s backstop poll down
// permanently, buffered the live stream's frames for that row for ever, and
// sat on top of a Move another GM had long since solved. So every draft is now
// stamped with the turn it belongs to and the moment it was last touched, and
// three rules follow from the stamps:
//
//   - It is pruned when the turn rolls over, or when the row it belongs to is
//     no longer on the desk (pruneDeskDrafts, called from seedDesk).
//   - It only holds the backstop poll down for THIS SITTING: after
//     DRAFT_FRESH_MS untouched it is still shown, still guarded on unload,
//     and still the thing the editor renders — it just stops claiming the
//     desk is mid-sentence. Typing makes it fresh again.
//   - It only buffers live frames while an editor holding it is actually
//     MOUNTED. A draft for a row nobody has open is not somebody writing.

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
// mid-sentence in and drains the buffer when the draft is cleared. The draft
// map IS the desk's record of which rows are dirty — keyed, unlike
// useDirtyGuard's global counter, which cannot say WHICH panel is dirty.
export const subscribeToDeskDrafts = subscribe;

// Whether a row is holding unsaved text right now AND somebody has it open.
// `key` is the same "move:<id>" / "caving:<id>" the editors use.
//
// The mount test is what stops the stream buffering a row's frames for ever:
// a draft left behind on a row nobody is looking at is recoverable text, not
// an interrupted sentence, and the desk should keep showing that row moving.
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

// Seeded from storage ONCE per key, then never read from storage again except
// when another tab's `storage` event says the value moved. A refusal or a bad
// JSON blob memoises null, so a blocked accessor isn't retried on every
// render.
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

// A stored blob from before the stamps existed is still somebody's narration,
// so it is read rather than thrown away — it just counts as written at the
// epoch, which makes it stale and unpinned to any turn, which is what it is.
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
    // Full, private, or blocked. The draft is safe in memory for this tab's
    // lifetime; only surviving a reload is lost.
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

// Drop every stored draft that the desk can no longer account for: one
// stamped with a different turn (the turn rolled over under it), and one whose
// row is not on the desk any more (somebody rejected or deleted it). Called
// from seedDesk, which is the one place that knows both answers.
//
// It walks localStorage rather than the memo, because the whole point is the
// keys this tab has never read — a draft left behind by a session three turns
// ago is invisible to the memo and is exactly what accumulates.
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
    // A draft written before the stamps existed carries no turn, so it is
    // judged on membership alone rather than being swept for a null.
    const wrongTurn = entry.turnId != null && entry.turnId !== currentTurnId;
    if (!wrongTurn && liveKeys.has(key)) continue;
    // Never sweep a row somebody has open and has typed into. Whatever the
    // membership arithmetic says, deleting the sentence being written in front
    // of the GM is never the right answer — it goes when the panel closes.
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

// Another tab wrote or cleared a draft. The memo is this tab's only reader, so
// it is invalidated rather than patched — the next read goes to storage and
// gets whatever the other tab left. Without this, two open desks each held
// their own idea of the same Result box until one of them reloaded.
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

// Returns the held draft, or null when the row's own saved values are what
// the editor should show. Mounting also registers this key as OPEN, which is
// what lets the live stream tell "somebody is writing here" from "somebody
// left words here once".
export function useDeskDraft(key) {
  const get = useCallback(() => readDeskDraft(key), [key]);
  useEffect(() => {
    if (!key) return undefined;
    mounts.set(key, (mounts.get(key) ?? 0) + 1);
    // A panel opening onto text it never saved means something took the panel
    // away mid-sentence. Worth one line (blackBox.js) — that used to be the
    // only trace the desk left of resetting itself.
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
