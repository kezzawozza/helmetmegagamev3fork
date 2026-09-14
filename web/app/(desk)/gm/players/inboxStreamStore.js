"use client";

import { useSyncExternalStore } from "react";

// Whether this desk tab's live inbox is being pushed to or is limping along
// on its backstop poll. Module store, not component state, because the
// stream effect writes it (react-hooks/set-state-in-effect) — same shape as
// chat/streamStore.js.
//
//   live      connected, or has never yet failed
//   backstop  dropped more than once in a row; waits for two since one
//             failure alone is common (e.g. a laptop waking)
//   fatal     never opened after several tries — a signed-out session (a 204
//             or 401 closes an EventSource without firing `open`)

const LIVE = "live";
const BACKSTOP = "backstop";
const FATAL = "fatal";

let state = LIVE;
const listeners = new Set();

function emit(next) {
  if (next === state) return;
  state = next;
  for (const cb of listeners) cb();
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return state;
}

function getServerSnapshot() {
  return LIVE;
}

export function useInboxStreamState() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function noteInboxStreamUp() {
  emit(LIVE);
}

// `failures` is how many drops in a row this is. The first is free.
export function noteInboxStreamDown(failures) {
  if (state === FATAL) return;
  if (failures >= 2) emit(BACKSTOP);
}

export function noteInboxStreamFatal() {
  emit(FATAL);
}
