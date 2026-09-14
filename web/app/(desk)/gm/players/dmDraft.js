"use client";

import { useCallback, useSyncExternalStore } from "react";

// Conversation composer draft. Memory (module Map) is the source of truth, localStorage a best-effort mirror only — a throwing setItem must never freeze typing. useSyncExternalStore, not useState+effect (react-hooks/set-state-in-effect); shared here, not pane-private, because the Canon tab's "Insert into reply" writes into it across the desk tree.

const EMPTY = "";

// Past this age a draft still shows/restores/guards but stops holding the desk's backstop poll down (useDirtyGuard.js#alsoDirtyHoldsPoll). Same number/reasoning as turns/deskDraft.js.
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

// Notify FIRST, mirror second, so a throwing setItem can't swallow the re-render. No `storage` event dispatched — a global one would wake every storage subscriber on the desk (e.g. usePins) per keystroke.
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

// Snapshot is a string, so useSyncExternalStore's identity check is satisfied by value equality.
export function useDmDraft(discordUserId) {
  const get = useCallback(() => readDmDraft(discordUserId), [discordUserId]);
  return useSyncExternalStore(subscribeDmDraft, get, () => EMPTY);
}
