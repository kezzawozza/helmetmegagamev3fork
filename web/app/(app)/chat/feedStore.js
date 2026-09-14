"use client";

import { useCallback, useSyncExternalStore } from "react";

// The Chat page's message store, modelled on the GM inbox's
// web/app/(desk)/gm/players/liveInbox.js: module-level state read through
// useSyncExternalStore, so a new message re-renders the one row it belongs to
// and nothing needs a provider.
//
// Two lists per place. `rows` is what the server has confirmed, keyed by seq.
// `pending` is what this tab has typed but not heard back about, keyed by a
// client id — the optimistic append that makes a send feel instant. A
// confirmed row carrying that same clientId replaces its pending twin.
//
// Every rebuild makes a new array and a new Map. react-hooks/immutability is
// an error in this repo, and a mutated array would not re-render anyway.

const EMPTY_ROWS = Object.freeze([]);

const EMPTY_PLACES = Object.freeze([]);

const state = {
  // The viewer's place list, replaced whole whenever the stream says it moved.
  places: EMPTY_PLACES,
  // placeKey -> frozen array of rows, ascending by seq, pending rows last
  views: new Map(),
  // placeKey -> Map<seq string, row>
  confirmed: new Map(),
  // placeKey -> Map<clientId, row>
  pending: new Map(),
  // placeKey -> "idle" | "loading" | "loaded"
  history: new Map(),
  // placeKey -> { loading, exhausted, floored }, the state of reading FURTHER
  // BACK than that first page (web/app/api/feed/history/route.js#before).
  // Separate from `history` above, which is about the first page only: a place
  // can be "loaded" and still have ten pages of scene behind it.
  backlog: new Map(),
};

// What a place with nothing asked for yet looks like. Frozen and shared, so
// useSyncExternalStore's snapshot is referentially stable for every place
// nobody has scrolled up in — a fresh object each read would re-render on
// every store frame.
const BACKLOG_IDLE = Object.freeze({ loading: false, exhausted: false, floored: false });

const listeners = new Set();

// Nonzero while seedInitial() below is running, which is the one moment this
// store is written DURING a render rather than from an effect or a stream
// frame. Notifying subscribers mid-render is the thing React warns about, so
// that window simply does not notify: nothing has subscribed yet at that
// point, and useSyncExternalStore reads the snapshot when it subscribes.
let quiet = 0;

function emit() {
  if (quiet > 0) return;
  for (const cb of listeners) cb();
}

export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function bySeq(a, b) {
  // String compare would put "9" after "10". BigInt is the only correct
  // comparison for this column.
  const x = BigInt(a.seq);
  const y = BigInt(b.seq);
  return x < y ? -1 : x > y ? 1 : 0;
}

function rebuild(place) {
  const confirmed = [...(state.confirmed.get(place)?.values() ?? [])].sort(bySeq);
  const pending = [...(state.pending.get(place)?.values() ?? [])];
  state.views = new Map(state.views);
  state.views.set(place, Object.freeze([...confirmed, ...pending]));
}

// Seeds the store from the server-rendered rows. Idempotent: a second call
// with the same rows changes nothing a reader can see.
export function seedRows(place, rows) {
  if (!place || !Array.isArray(rows)) return;
  const next = new Map(state.confirmed.get(place) ?? []);
  let changed = false;
  for (const row of rows) {
    if (!row?.seq || next.has(row.seq)) continue;
    next.set(row.seq, row);
    changed = true;
  }
  if (!changed) return;
  state.confirmed = new Map(state.confirmed);
  state.confirmed.set(place, next);
  rebuild(place);
  emit();
}

// One row in, from the stream or from a send's own answer. Deduped by seq,
// and it evicts the pending row it is the confirmation of.
export function applyRow(place, row) {
  if (!place || !row?.seq) return;
  const confirmed = state.confirmed.get(place) ?? new Map();
  const existing = confirmed.get(row.seq);
  // An edit arrives as the same seq with a newer editedAt. Known-and-identical
  // is the only case worth ignoring; known-and-changed has to replace, or the
  // reader keeps the words their author took back.
  const known = Boolean(existing) && (existing.editedAt ?? null) === (row.editedAt ?? null);

  // The same row reaches this tab twice on a send: once on the stream and
  // once as the POST's own answer, and the stream is usually first — a NOTIFY
  // beats a round trip. Both carry the clientId now (db/lib/feedNotify.js),
  // so whichever arrives evicts the pending twin, and the second is a no-op.
  let twin = null;
  let evicted = false;
  if (row.clientId) {
    const pending = state.pending.get(place);
    twin = pending?.get(row.clientId) ?? null;
    if (twin) {
      const stillPending = new Map(pending);
      stillPending.delete(row.clientId);
      state.pending = new Map(state.pending);
      state.pending.set(place, stillPending);
      evicted = true;
    }
  }

  if (known && !evicted) return;

  if (!known) {
    // The clientId stays ON the confirmed row, because Feed.js keys by it:
    // the pending row and the row that confirms it are then the same React
    // key, so the same <li> and the same <img> survive the swap instead of
    // one unmounting as another mounts and refetches the face.
    //
    // avatarVersion is sticky for the same reason. It is a cache-buster on
    // the face's URL, and the copy that arrives is not always carrying the
    // same one as the copy already on screen (see feedHub.js#avatarVersionFor
    // for why) — a row already drawn keeps the URL it was drawn with.
    //
    // avatarPath deliberately is NOT. It is not a cache-buster but the face
    // itself, frozen on the row by the server, and the spread below lets the
    // confirmed value (null included) replace whatever the optimistic row
    // guessed. The two agree in every ordinary case, and where they don't the
    // server is right.
    const carried = twin ?? existing ?? null;
    const clientId = row.clientId ?? carried?.clientId ?? null;
    const stored = {
      ...row,
      ...(clientId ? { clientId } : {}),
      ...(carried?.avatarVersion != null ? { avatarVersion: carried.avatarVersion } : {}),
    };
    const next = new Map(confirmed);
    next.set(row.seq, stored);
    state.confirmed = new Map(state.confirmed);
    state.confirmed.set(place, next);
  }

  rebuild(place);
  emit();
}

// A row somebody took back. Dropped rather than tombstoned: the feed is the
// live scene, and /archive keeps the record.
export function removeRow(place, seq) {
  if (!place || !seq) return;
  const confirmed = state.confirmed.get(place);
  if (!confirmed?.has(String(seq))) return;
  const next = new Map(confirmed);
  next.delete(String(seq));
  state.confirmed = new Map(state.confirmed);
  state.confirmed.set(place, next);
  rebuild(place);
  emit();
}

export function addPending(place, row) {
  if (!place || !row?.clientId) return;
  const next = new Map(state.pending.get(place) ?? []);
  next.set(row.clientId, { ...row, pending: true, failed: false });
  state.pending = new Map(state.pending);
  state.pending.set(place, next);
  rebuild(place);
  emit();
}

// A send that came back an error. The row stays on screen rather than
// vanishing — losing what you typed is worse than seeing it marked unsent.
export function markPendingFailed(place, clientId) {
  const pending = state.pending.get(place);
  if (!pending?.has(clientId)) return;
  const next = new Map(pending);
  next.set(clientId, { ...pending.get(clientId), pending: false, failed: true });
  state.pending = new Map(state.pending);
  state.pending.set(place, next);
  rebuild(place);
  emit();
}

export function retryPending(place, clientId) {
  const pending = state.pending.get(place);
  const row = pending?.get(clientId);
  if (!row) return null;
  const next = new Map(pending);
  next.set(clientId, { ...row, pending: true, failed: false });
  state.pending = new Map(state.pending);
  state.pending.set(place, next);
  rebuild(place);
  emit();
  return row;
}

// What the column and the composer are drawn from, per place. The two seq
// watermarks are deliberately NOT in it: they move whenever anybody speaks,
// and a list that "changed" every time somebody said something would make
// every reconnect look like a walk.
function placeShape(place) {
  return [
    place.placeKey,
    place.kind,
    place.name,
    place.description ?? "",
    place.roomKind ?? "",
    place.canSpeak ? 1 : 0,
    place.slowmodeSeconds ?? 0,
  ].join(" ");
}

function sameShape(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (placeShape(a[i]) !== placeShape(b[i])) return false;
  }
  return true;
}

// The place list, pushed by the stream's `event: places` and seeded by the
// server render. Replaced whole rather than merged: it IS the answer to
// "where may you be", and half of an old one is a place you have left.
//
// Returns whether the list's SHAPE changed — the doors, their names, who may
// speak where — which is what Chat.js asks when a reconnect re-announces the
// list: a walk that happened while the tab was away shows up here, and a
// reconnect that found nothing different does not. The comparison lives in
// the store rather than in Chat.js because the stream handler that asks is
// per mount, and a closure over the render's list would be stale for good.
export function setPlaces(places) {
  if (!Array.isArray(places)) return false;
  const changed = !sameShape(state.places, places);
  state.places = Object.freeze(places);
  emit();
  return changed;
}

function getPlaces() {
  return state.places;
}

function getServerPlaces() {
  return EMPTY_PLACES;
}

export function usePlaces() {
  return useSyncExternalStore(subscribe, getPlaces, getServerPlaces);
}

// Whether this tab has already asked for a place's history — and, since the
// loading flash, WHICH of the three states it is in: "idle" (nobody has
// asked), "loading" (a fetch is out) or "loaded" (the backlog is in the
// store). A place with no rows and no fetch behind it looks exactly like an
// empty one, which is why "Nothing has been said here yet." used to flash
// for a beat every time a room was opened.
//
// A Map on `state` rather than a bare Set, because Feed.js SUBSCRIBES to this
// now: the skeleton has to come down the moment the rows land.
const HISTORY_IDLE = "idle";

function setHistoryState(place, next) {
  if (!place) return;
  if (state.history.get(place) === next) return;
  state.history = new Map(state.history);
  state.history.set(place, next);
  emit();
}

export function markHistoryLoading(place) {
  setHistoryState(place, "loading");
}

export function markHistoryLoaded(place) {
  setHistoryState(place, "loaded");
}

// Every place back to "idle", so the next selection and the prefetch ask the
// history route again. The stream's `gap` event is what calls this: the
// reconnect's catch-up was too long to replay row by row, so the backlog is
// re-read place by place instead — which is also the only path that repairs
// a line deleted or changed while the tab was away. The rows already held
// stay; seedRows merges by seq.
export function resetHistory() {
  if (state.history.size === 0 && state.backlog.size === 0) return;
  state.history = new Map();
  // The backlog goes with it. A stale `exhausted` would tell a reader there
  // is nothing further back when the re-read has only fetched the newest
  // hundred again, and a stale `loading` would wedge the scroll-up for good.
  state.backlog = new Map();
  emit();
}

// The state of reading further back in one place.
export function backlogOf(place) {
  return state.backlog.get(place) ?? BACKLOG_IDLE;
}

export function setBacklog(place, patch) {
  if (!place) return;
  const current = backlogOf(place);
  const next = { ...current, ...patch };
  if (
    next.loading === current.loading &&
    next.exhausted === current.exhausted &&
    next.floored === current.floored
  ) {
    return;
  }
  state.backlog = new Map(state.backlog);
  state.backlog.set(place, next);
  emit();
}

export function useBacklog(place) {
  const snapshot = useCallback(() => backlogOf(place), [place]);
  const server = useCallback(() => BACKLOG_IDLE, []);
  return useSyncExternalStore(subscribe, snapshot, server);
}

// "Has this tab already asked?" — the guard that keeps the empty state from
// firing a request on every render. Both a fetch in flight and one already
// answered count as asked.
export function historyLoaded(place) {
  return (state.history.get(place) ?? HISTORY_IDLE) !== HISTORY_IDLE;
}

function historyStateOf(place) {
  return state.history.get(place) ?? HISTORY_IDLE;
}

export function useHistoryState(place) {
  const snapshot = useCallback(() => historyStateOf(place), [place]);
  const server = useCallback(() => HISTORY_IDLE, []);
  return useSyncExternalStore(subscribe, snapshot, server);
}

// The newest confirmed seq this tab holds for a place, as a string, or null.
// The unread dot compares it against what the reader has seen.
export function newestSeq(place) {
  const rows = state.confirmed.get(place);
  if (!rows || rows.size === 0) return null;
  let best = 0n;
  for (const key of rows.keys()) {
    const seq = BigInt(key);
    if (seq > best) best = seq;
  }
  return String(best);
}

// The oldest confirmed seq this tab holds for a place, as a string, or null.
// The cursor a scroll-up pages from — read off the store rather than
// remembered from the last response, so the rows the page server-rendered
// count too.
export function oldestSeq(place) {
  const rows = state.confirmed.get(place);
  if (!rows || rows.size === 0) return null;
  let best = null;
  for (const key of rows.keys()) {
    const seq = BigInt(key);
    if (best === null || seq < best) best = seq;
  }
  return best === null ? null : String(best);
}

// Is this row one the VIEWER wrote?
//
// The one place to ask, because an aliased row — a hood or a forced name —
// ships no character id to anybody at all (db/lib/archive.js#feedRowShape).
// Four separate hand-rolled `row.characterId === self.characterId` checks
// answered this before, and when the id went away three of them silently
// started answering "no" for a player's own hooded lines: the slow-mode
// countdown stopped counting, the NEW divider drew above their own words, and
// the chime rang at them for their own mention.
//
// `selfKey` is the viewer's own hoodToken (play/page.js). Learning your own
// tells you nothing — it is the one hood you were already under.
export function isOwnRow(row, selfId, selfKey = null) {
  if (!row) return false;
  if (selfId && row.characterId === selfId) return true;
  if (selfKey && row.speakerKey === selfKey) return true;
  return false;
}

// Did somebody SAY something here?
//
// What the unread mark draws off. Two conditions, and that is the whole rule:
// the row is not yours, and it is not the game talking to itself.
//
// It used to be narrower — a row in a conversation, or one carrying your
// {char:…} token, and nothing else. That meant ordinary roleplay in a Room
// moved no mark at all, and a GM (who is in GM mode precisely BECAUSE they
// have no character) had no token and sat in no conversations, so nothing in
// Chat ever lit for them and the only way to find a scene was to open every
// channel in turn. Widening it to "somebody spoke" subsumes both of the old
// arms — a conversation row is a person speaking, and so is a mention.
//
// SYSTEM is the line that keeps this from being the failure the narrow rule
// was avoiding. A gate crossing, a smell in a Location, somebody shifting a
// stash, the turn banner: all scenery, all `source: "SYSTEM"`, none of it
// worth lighting a channel for. Real speech is DISCORD (proxied) or WEB
// (typed here), and `source` already rides on every row.
//
// `place` is the placeKey. It is no longer read — kept in the signature
// because every caller passes it and the store is keyed by it.
//
// The CHIME is deliberately narrower and did NOT move: Chat.js rings only on
// a mention, because a busy room ringing on every line is a reason to mute
// the Chat rather than a reason to look at it. A mark is patient; a sound is
// not.
export function isNotableRow(place, row, selfId, selfKey = null) {
  if (!row) return false;
  // Your own words are not news, whichever handle the row carries. A GM has
  // no character, so there is nothing of theirs to exclude.
  if (selfId && isOwnRow(row, selfId, selfKey)) return false;
  return row.source !== "SYSTEM";
}

// The newest NOTABLE seq this tab holds for a place, as a string, or null.
// The dot compares this against the read mark, which is the newest seq
// overall — so reading to the bottom of a place clears it however it was lit.
export function notableSeq(place, selfId, selfKey = null) {
  const rows = state.confirmed.get(place);
  if (!rows || rows.size === 0) return null;
  let best = null;
  for (const [key, row] of rows) {
    if (!isNotableRow(place, row, selfId, selfKey)) continue;
    const seq = BigInt(key);
    if (best === null || seq > best) best = seq;
  }
  return best === null ? null : String(best);
}

// Chat's FIRST seed, from the server render, run inside a useState
// initializer so the store is full before the first client paint (Chat.js
// says why). It is the same three writes the effect repeats, with the
// notification held: see `quiet` at the top of this file.
export function seedInitial({ places, place, rows }) {
  quiet += 1;
  try {
    if (place && Array.isArray(rows)) seedRows(place, rows);
    if (Array.isArray(places)) setPlaces(places);
    if (place) markHistoryLoaded(place);
  } finally {
    quiet -= 1;
  }
}

function getServerRows() {
  return EMPTY_ROWS;
}

export function useFeed(place) {
  const snapshot = useCallback(() => state.views.get(place) ?? EMPTY_ROWS, [place]);
  return useSyncExternalStore(subscribe, snapshot, getServerRows);
}
