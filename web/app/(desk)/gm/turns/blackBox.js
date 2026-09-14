"use client";

// The desk's black box: a desk that resets itself silently (redraws, loses
// the Result box/composer/selection) is undebuggable, so it keeps the last
// twenty things that happened to it in sessionStorage and logs one console
// line when it comes up somewhere it shouldn't. Deliberately off the hot
// path: one array write per NAMED event (mutation, navigation, mount), never
// per keystroke, frame or row.

import { readSession, writeSession } from "@/app/components/useSessionState";

const KEY = "gm-desk-blackbox";
const MAX = 20;
const EMPTY = [];

// Lives for the JavaScript context's life, so a remount (module survives) is told apart from a reload (it doesn't).
const context = Math.random().toString(36).slice(2, 8);

export function noteDesk(kind, detail = null) {
  if (kind === "select") noteUse();
  try {
    const log = readSession(KEY, EMPTY) ?? EMPTY;
    const next = [...log.slice(-(MAX - 1)), { t: Date.now(), context, kind, detail }];
    writeSession(KEY, next);
  } catch {
    /* private window, blocked storage — the desk works, it just forgets */
  }
}

function deskTrail() {
  return readSession(KEY, EMPTY) ?? EMPTY;
}

// The one line. Called where the desk notices it came up somewhere unexpected: a remount, or a draft handed back to a panel that never saved it.
export function reportDeskReset(reason) {
  const trail = deskTrail();
  const chain = trail
    .slice(-8)
    .map((e) => `${e.kind}${e.detail ? `(${e.detail})` : ""}`)
    .join(" → ");
  console.warn(`desk reset: ${reason}${chain ? ` — ${chain}` : ""}`);
  noteDesk("reset", reason);
}

// Whether a Workspace mounting now is the FIRST this JS context has seen — a
// second means the tree was torn down and rebuilt without a page reload.
let mounted = 0;
let usedSinceMount = false;
export function noteWorkspaceMount() {
  mounted += 1;
  noteDesk("mount", `#${mounted}`);
  // Only a remount that interrupted WORK is worth a line — StrictMode's double-mount before any touch isn't.
  if (mounted > 1 && usedSinceMount) {
    reportDeskReset(`workspace remounted (${mounted}) without a reload`);
  }
  usedSinceMount = false;
}

// Called by the black box itself for the events that mean somebody was
// working: picking a row is the cheapest honest proxy.
function noteUse() {
  usedSinceMount = true;
}
