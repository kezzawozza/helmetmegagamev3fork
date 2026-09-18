"use client";

import { peekSnapshot, writeSnapshot } from "@/lib/snapshot/snapshotStore";
import { rowWindows, seedRows, subscribe } from "./feedStore";

// Switching places paints from cache (REDESIGN.md §6). `feedStore` already holds
// every place this tab has read, so a switch inside one session is already
// instant; this is the half that survives a reload. It keeps the last window of
// rows for the places nearest the reader in the snapshot layer
// (web/lib/snapshot), beside the `play` snapshot the page itself paints from —
// its own scope, because the page snapshot is server props and this is what the
// browser has since heard.
//
// Not a source of truth, and never trusted as one: the history route is asked
// for every place exactly as before, `seedRows` only ADDS, and every server
// action re-validates from the database. This only decides what is on screen
// while that request is out.
const SCOPE = "play:rows";

// Enough to fill a tall column and no more. The window is what a reader sees
// before the history route answers, not the scene's whole memory.
const PER_PLACE = 40;
const MAX_PLACES = 12;

// How long a stored window is worth painting. A turn-end wipe raises a place's
// floor (CHAT.md §7) and this cache cannot know it happened, so stale rows would
// sit above the fresh ones — `seedRows` adds and never removes. Half an hour is
// long enough to cover a reload, a crash and a tab restored from history, and
// short enough that a wipe almost never falls inside one.
const FRESH_MS = 30 * 60 * 1000;

// Rows are written at most this often. A busy street is several lines a second
// and each write is a JSON.stringify into localStorage.
const WRITE_EVERY_MS = 4000;

// Paint what this browser last heard. Called from Chat's state initializer, so
// the rows are in the store before the first client paint — from an effect the
// first frame is a skeleton and the cache buys nothing.
export function seedCachedRows(userId) {
  if (!userId) return;
  const stored = peekSnapshot(SCOPE, userId);
  if (!stored?.at || !Array.isArray(stored.places)) return;
  if (Date.now() - stored.at > FRESH_MS) return;
  for (const entry of stored.places) {
    if (!entry?.placeKey || !Array.isArray(entry.rows)) continue;
    seedRows(entry.placeKey, entry.rows);
  }
}

// Keeps the stored windows in step with the store, coarsely. Returns a disposer,
// so Chat can hang it off an effect — it sets no state, which is what lets it.
export function startRowCache(userId) {
  if (!userId) return () => {};
  let timer = null;
  let dirty = false;

  const flush = () => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    try {
      writeSnapshot(SCOPE, userId, { at: Date.now(), places: rowWindows(PER_PLACE, MAX_PLACES) });
    } catch {
      // A refused localStorage costs the next visit a skeleton, nothing more.
    }
  };

  const unsubscribe = subscribe(() => {
    dirty = true;
    if (timer) return;
    timer = setTimeout(flush, WRITE_EVERY_MS);
  });

  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
    // One last write on the way out, so the place somebody was reading when they
    // left is the one that paints when they come back.
    flush();
  };
}
