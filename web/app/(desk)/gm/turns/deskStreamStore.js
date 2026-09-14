"use client";

import { useSyncExternalStore } from "react";

// Whether this adjudication tab's live channel is being pushed to or is
// limping along on its backstop poll. Module store, not component state,
// because the stream effect writes it (react-hooks/set-state-in-effect).
//
//   live      connected, or has never yet failed
//   backstop  dropped more than once in a row; the chip waits for two since
//             one failure alone is common (e.g. a laptop waking)
//   fatal     never opened after several tries — a signed-out session or lost
//             GM role (a 204 closes an EventSource without firing `open`)
//
// A SIBLING OF inboxStreamStore.js RATHER THAN A SHARED ONE: a GM can have
// both desks open at once and each answers for itself; the states are
// already drifting apart, so a shared keyed store is a worse trade than the
// duplication.

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

export function useDeskStreamState() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function noteDeskStreamUp() {
  emit(LIVE);
}

// `failures` is how many drops in a row this is. The first is free.
export function noteDeskStreamDown(failures) {
  if (state === FATAL) return;
  if (failures >= 2) emit(BACKSTOP);
}

export function noteDeskStreamFatal() {
  emit(FATAL);
}
