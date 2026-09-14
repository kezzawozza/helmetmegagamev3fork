"use client";

import { useCallback, useSyncExternalStore } from "react";

// The conversation composer's draft. MEMORY is the source of truth and
// localStorage is a best-effort mirror — never the other way round, so a
// throwing `setItem` (quota full) can't freeze a GM's typing. Value lives in
// a module Map, read via useSyncExternalStore over our own listeners — same
// shape as `useSessionState.js`, no useState seeded from an effect
// (react-hooks/set-state-in-effect). Shared here, not private to the pane,
// because the inspector's Canon tab ("Insert into reply") writes into it
// across the desk shell tree.

const EMPTY = "";

// How long a draft counts as somebody mid-sentence; past it the draft is
// still shown/restored/guarded but stops holding the desk's backstop poll
// down (useDirtyGuard.js#alsoDirtyHoldsPoll). Same number and reasoning as
// turns/deskDraft.js.
const DRAFT_FRESH_MS = 10 * 60 * 1000;

const drafts = new Map(); // discordUserId -> draft string, source of truth
const writtenAt = new Map(); // discordUserId -> last typed-into time, this tab
const listeners = new Set();

function dmDraftKey(discordUserId) {
  return `messages-draft-${discordUserId}`;
}

function emit() {
  for (const callback of listeners) callback();
}

// Seeded from storage ONCE per conversation; a refusal memoises "" so it isn't retried every render.
function readDmDraft(discordUserId) {
  if (!discordUserId) return EMPTY;
  const held = drafts.get(discordUserId);
  if (held !== undefined) return held;
  let stored = EMPTY;
  try {
    stored = window.localStorage.getItem(dmDraftKey(discordUserId)) ?? EMPTY;
  } catch {
    /* private window / blocked site data */
  }
  drafts.set(discordUserId, stored);
  return stored;
}

// Notify FIRST, mirror second, so a throwing setItem can't swallow the
// re-render. No `storage` event is dispatched — nothing else reads
// `messages-draft-*`, and a global dispatch would wake every storage
// subscriber on the desk (e.g. usePins) on every keystroke.
export function writeDmDraft(discordUserId, value) {
  if (!discordUserId) return;
  const next = value ?? EMPTY;
  drafts.set(discordUserId, next);
  if (next) writtenAt.set(discordUserId, Date.now());
  else writtenAt.delete(discordUserId);
  emit();
  try {
    if (next) window.localStorage.setItem(dmDraftKey(discordUserId), next);
    else window.localStorage.removeItem(dmDraftKey(discordUserId));
  } catch {
    // Full, private, or blocked; the draft still survives in memory for this tab.
  }
}

// Whether this draft was typed into recently enough to count as live. Read by ConversationPane's poll gate.
export function dmDraftFresh(discordUserId, nowMs = Date.now()) {
  if (!discordUserId) return false;
  const at = writtenAt.get(discordUserId);
  if (!at) return false;
  return nowMs - at < DRAFT_FRESH_MS;
}

function subscribeDmDraft(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// The snapshot is a string, so useSyncExternalStore's identity check is
// satisfied by value equality — nothing to memoise.
export function useDmDraft(discordUserId) {
  const get = useCallback(() => readDmDraft(discordUserId), [discordUserId]);
  return useSyncExternalStore(subscribeDmDraft, get, () => EMPTY);
}
