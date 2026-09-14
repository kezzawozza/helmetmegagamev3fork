"use client";

import { useCallback, useSyncExternalStore } from "react";

// Live inbox client store — what LiveInboxPoller.js fills, read by the rail and conversation pane. Module-level,
// read through useSyncExternalStore. patches: per conversation, rail fields that moved, stamped with DB clock read
// time, applied (mergeRailRows) only when newer than the held row. feeds: per conversation, message rows arrived
// since load. Every rebuild makes a new Map/array — react-hooks/immutability is an error.

const EMPTY_PATCHES = new Map();
const EMPTY_READ_OVERRIDES = new Map();
const EMPTY_FEED = Object.freeze([]);
const SEEN_CAP = 2000;

// How long a read override stands before dropping on age alone — normally clears on the server's echo; this only catches the echo never arriving.
const READ_OVERRIDE_MAX_AGE_MS = 5 * 60_000;

const state = {
  patches: EMPTY_PATCHES,
  feeds: new Map(),
  cursorMs: 0,
  seen: new Set(),
  readOverrides: new Map(), // discordUserId -> { cursorMs, atMs }, known before any server row says so
};
const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getCursorMs() {
  return state.cursorMs;
}

function getPatches() {
  return state.patches;
}
function getReadOverrides() {
  return state.readOverrides;
}
function getServerReadOverrides() {
  return EMPTY_READ_OVERRIDES;
}
function getServerPatches() {
  return EMPTY_PATCHES;
}
function getServerFeed() {
  return EMPTY_FEED;
}

function messageTime(m) {
  return new Date(m.createdAt).getTime();
}

function byTimeThenId(a, b) {
  const d = messageTime(a) - messageTime(b);
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Folds one poll result in. `sinceMs` is the request's cursor (0 on first tick); `announce` says whether anything
// found is news — the first tick's two-minute lookback must not ring. Returns INBOUND arrivals worth announcing.
export function applyDelta(delta, { sinceMs = 0, announce = true } = {}) {
  let changed = false;
  const inbound = [];

  if (Number.isFinite(delta?.cursorMs)) state.cursorMs = delta.cursorMs;

  if (Array.isArray(delta?.rail) && delta.rail.length > 0) {
    const next = new Map(state.patches);
    for (const patch of delta.rail) {
      if (!patch?.discordUserId) continue;
      // Older than what's held has nothing to say — the stream and the 30s backstop poll can race, and setting unconditionally would let a stale backstop answer overwrite a fresher zero-unread state.
      const prev = next.get(patch.discordUserId);
      if (prev && prev.asOfMs > delta.nowMs) continue;
      next.set(patch.discordUserId, { ...patch, asOfMs: delta.nowMs });
    }
    state.patches = next;
    changed = true;
  }

  // `thread` (singular) is the backstop poll's, for whichever conversation is open. `threads` (plural) is the
  // stream's, for EVERY conversation that moved. Folded through one function so the two paths don't drift.
  const thread = delta?.thread;
  const threadList = [
    ...(thread?.discordUserId ? [thread] : []),
    ...(Array.isArray(delta?.threads) ? delta.threads : []),
  ];
  const openThreadIds = new Set(threadList.map((t) => t.discordUserId));

  for (const t of threadList) {
    if (!t?.discordUserId || !Array.isArray(t.messages) || t.messages.length === 0) continue;
    const fresh = t.messages.filter((m) => m?.id && !state.seen.has(m.id));
    if (fresh.length === 0) continue;
    for (const m of fresh) {
      state.seen.add(m.id);
      if (announce && m.direction === "INBOUND") {
        inbound.push({ id: m.id, discordUserId: t.discordUserId });
      }
    }
    const current = state.feeds.get(t.discordUserId) ?? EMPTY_FEED;
    const merged = Object.freeze([...current, ...fresh].sort(byTimeThenId));
    const feeds = new Map(state.feeds);
    feeds.set(t.discordUserId, merged);
    state.feeds = feeds;
    changed = true;
  }

  // Inbound rows on conversations that are NOT open never reach `feeds`, so the chime hears about them from the
  // rail patch instead — but "inbound" alone isn't news, only a last message newer than the asked-for cursor is.
  if (announce && Array.isArray(delta?.rail)) {
    for (const patch of delta.rail) {
      if (patch?.lastDirection !== "INBOUND") continue;
      if (openThreadIds.has(patch.discordUserId)) continue; // already announced above, as a row
      if (!(patch.lastAtMs > sinceMs)) continue;
      const key = `rail:${patch.discordUserId}:${patch.lastAtMs}`;
      if (state.seen.has(key)) continue;
      state.seen.add(key);
      inbound.push({ id: key, discordUserId: patch.discordUserId });
    }
  }

  if (state.seen.size > SEEN_CAP) {
    state.seen = new Set([...state.seen].slice(-SEEN_CAP));
  }

  if (changed) emit();
  return { inbound };
}

// The GM read this conversation, said here before the server answered; mergeRailRows lays it over the row last so
// the badge clears on click. The optimistic caller guesses the cursor from the BROWSER's clock (can be minutes off), so the server's later answer REPLACES it — else a fast clock would strand its own over-claim and the badge never returns.
export function noteConversationRead(discordUserId, cursorMs, { fromServer = false } = {}) {
  if (!discordUserId || !Number.isFinite(cursorMs)) return;
  const prev = state.readOverrides.get(discordUserId);
  if (!fromServer && prev && prev.cursorMs >= cursorMs) return;
  if (prev && prev.cursorMs === cursorMs) return;
  const next = new Map(state.readOverrides);
  next.set(discordUserId, { cursorMs, atMs: Date.now() });
  state.readOverrides = next;
  emit();
}

// Drops an override once the server has caught up, or once it's old. Called
// from an effect, never during render — mergeRailRows must stay pure (two useMemo callers).
export function reconcileReadOverrides(rows, rowsAsOfMs) {
  if (state.readOverrides.size === 0) return;
  const cutoff = Date.now() - READ_OVERRIDE_MAX_AGE_MS;
  let next = null;
  for (const [id, override] of state.readOverrides) {
    const row = rows.find((r) => r.discordUserId === id);
    const echoed = row && rowsAsOfMs > override.atMs && (row.lastReadAtMs ?? 0) >= override.cursorMs;
    if (!echoed && override.atMs > cutoff) continue;
    next = next ?? new Map(state.readOverrides);
    next.delete(id);
  }
  if (!next) return;
  state.readOverrides = next;
  emit();
}

export function useReadOverrides() {
  return useSyncExternalStore(subscribe, getReadOverrides, getServerReadOverrides);
}

export function useRailPatches() {
  return useSyncExternalStore(subscribe, getPatches, getServerPatches);
}

export function useThreadFeed(discordUserId) {
  const snap = useCallback(() => state.feeds.get(discordUserId) ?? EMPTY_FEED, [discordUserId]);
  return useSyncExternalStore(subscribe, snap, getServerFeed);
}

// Lays the live patches over the layout's rows. A patch applies as a whole or not at all — mixing half a patch
// with half a row could say "handled" against a newer message. A patch for someone unseen carries a whole `row` to append.
export function mergeRailRows(rows, patches, rowsAsOfMs, readOverrides = EMPTY_READ_OVERRIDES) {
  if ((!patches || patches.size === 0) && readOverrides.size === 0) return rows;
  // A read override applies PER FIELD (unread count only), not the patch's all-or-nothing rule, since it's local, not a server read; lastDirection stays alone — reading isn't writing last.
  const applyRead = (row) => {
    const o = readOverrides.get(row.discordUserId);
    if (!o || !(o.cursorMs > (row.lastReadAtMs ?? 0))) return row;
    return { ...row, unreadCount: 0, lastReadAtMs: o.cursorMs };
  };
  const known = new Set();
  const merged = rows.map((r) => {
    known.add(r.discordUserId);
    const p = patches?.get(r.discordUserId);
    if (!p || !(p.asOfMs > rowsAsOfMs)) return applyRead(r);
    const { asOfMs: _asOf, row: _row, ...fields } = p;
    void _asOf;
    void _row;
    return applyRead({ ...r, ...fields });
  });
  for (const [id, p] of patches ?? EMPTY_PATCHES) {
    if (known.has(id) || !(p.asOfMs > rowsAsOfMs) || !p.row) continue;
    const { asOfMs: _asOf, row, ...fields } = p;
    void _asOf;
    merged.push(applyRead({ ...row, ...fields }));
  }
  return merged;
}
