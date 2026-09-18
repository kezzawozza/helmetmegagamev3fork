"use client";

import { useSyncExternalStore } from "react";

// The second of Chat's two levels (REDESIGN.md §6, Discord's shape):
//
//   UNREAD    something notable was said in a place you have not read to the
//             bottom of. The place's name brightens. No number. ./seenStore.js
//             owns this, and has always owned it.
//   NOTIFIED  something was said TO YOU: your name, a line in your Bascinet
//             mail, a DM. A red count, the chime, and a browser notification
//             while the tab is hidden. This file owns that.
//
// Kept apart on purpose. Unread is a watermark and answers itself — the newest
// notable seq against the mark. Notified is a COUNT of events, so it has to be
// accumulated as they arrive, and a watermark cannot say "three people said your
// name". SYSTEM scenery counts for neither.
//
// Per browser, in localStorage, read through useSyncExternalStore — never an
// effect writing state (react-hooks/set-state-in-effect is an error here). Same
// shape as ./seenStore.js, and deliberately the same shape: one string snapshot
// for the whole map, so the column's props hold still between changes.

const PREFIX = "bascinet:notified:";

const listeners = new Set();

let cached = null;

function invalidate() {
  cached = null;
}

function emit() {
  invalidate();
  for (const cb of listeners) cb();
}

function subscribe(callback) {
  // Another tab may have read a place, or been notified in one, since the last
  // visit.
  invalidate();
  listeners.add(callback);
  const onStorage = () => {
    invalidate();
    callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function scan() {
  const parts = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      parts.push(`${key.slice(PREFIX.length)}=${window.localStorage.getItem(key)}`);
    }
  } catch {
    return "";
  }
  return parts.sort().join("|");
}

function read() {
  if (cached === null) cached = scan();
  return cached;
}

function readServer() {
  return "";
}

let parsedFor = null;
let parsedMap = new Map();

function parse(snapshot) {
  if (snapshot === parsedFor) return parsedMap;
  const map = new Map();
  if (snapshot) {
    for (const part of snapshot.split("|")) {
      const at = part.lastIndexOf("=");
      if (at <= 0) continue;
      const count = Number(part.slice(at + 1));
      if (Number.isFinite(count) && count > 0) map.set(part.slice(0, at), count);
    }
  }
  parsedFor = snapshot;
  parsedMap = map;
  return map;
}

// Capped, because the number stops being information long before this. Discord
// draws the same cap.
export const NOTIFIED_CAP = 99;

function countOf(placeKey) {
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${placeKey}`);
    const count = Number(raw);
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

// Somebody said your name, or the game wrote to you. `notice` is what a browser
// notification would say — pass none and none is shown.
export function noteNotified(placeKey, notice = null) {
  if (!placeKey) return;
  const next = Math.min(NOTIFIED_CAP, countOf(placeKey) + 1);
  try {
    window.localStorage.setItem(`${PREFIX}${placeKey}`, String(next));
  } catch {
    // The count is lost; the chime and the notification below are not.
  }
  emit();
  if (notice) showNotification(placeKey, notice);
}

// The place was read. Discord clears the count the moment you look at the
// channel, and so does this — a count you have to dismiss is a second chore.
export function clearNotified(placeKey) {
  if (!placeKey) return;
  try {
    if (window.localStorage.getItem(`${PREFIX}${placeKey}`) === null) return;
    window.localStorage.removeItem(`${PREFIX}${placeKey}`);
  } catch {
    return;
  }
  emit();
}

// The tick in the column's foot marks everywhere read, so it clears these too.
export function clearAllNotified() {
  let wrote = false;
  try {
    const doomed = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(PREFIX)) doomed.push(key);
    }
    for (const key of doomed) {
      window.localStorage.removeItem(key);
      wrote = true;
    }
  } catch {
    return;
  }
  if (wrote) emit();
}

// A notification only while the tab is HIDDEN. Onscreen, the count, the chime
// and the line itself have already said it three times over, and an OS banner
// over a page you are looking at is the thing everybody turns off.
//
// Permission is never ASKED for here. Web Push already asks, once, behind the
// bell in the places column (./pushStore.js), and a page that prompts on its own
// the first time somebody's name comes up is the pattern browsers added the
// permanent block for. Nothing is shown until that has been granted.
function showNotification(placeKey, notice) {
  try {
    if (typeof Notification === "undefined") return;
    if (document.visibilityState !== "hidden") return;
    if (Notification.permission !== "granted") return;
    // `tag` is the place, so a busy room replaces its own banner instead of
    // stacking eleven of them.
    const shown = new Notification(notice.title, { body: notice.body ?? "", tag: `chat:${placeKey}` });
    shown.onclick = () => {
      try {
        window.focus();
        window.location.hash = `#${encodeURIComponent(placeKey)}`;
        shown.close();
      } catch {
        // Nothing to do about a browser that refuses to come to the front.
      }
    };
  } catch {
    // A browser that refuses to construct one costs a banner, nothing more.
  }
}

export function useNotified() {
  return parse(useSyncExternalStore(subscribe, read, readServer));
}
