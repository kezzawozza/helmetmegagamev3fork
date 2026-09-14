"use client";

// The desk's black box.
//
// The adjudication desk once had a bug nobody could reproduce by hand: every
// so often it redrew and took the Result box, the open composer and the
// selection with it. No reload, no navigation, nothing in the console — just a
// GM saying "it did it again". It turned out to be Next remounting the route
// segment when the selection moved from one path param to another under a
// router.refresh() (page.js#parseSelection). That is fixed, but the class of
// bug is not: a desk that resets itself silently is a desk nobody can debug.
//
// So the desk keeps the last twenty things that happened to it in
// sessionStorage, and when it comes back up somewhere it should not have, it
// says so in one console line. Deliberately tiny and deliberately off the hot
// path: one array write per NAMED event (a mutation, a navigation, a mount),
// never per keystroke, per frame or per row.

import { readSession, writeSession } from "@/app/components/useSessionState";

const KEY = "gm-desk-blackbox";
const MAX = 20;
const EMPTY = [];

// A mount id that lives for the life of the JavaScript context, so a remount
// (new module state is NOT created — the module survives) can be told apart
// from a reload (it is).
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

// The one line. Called where the desk notices it has come up somewhere it did
// not expect to: a workspace mounting again inside a context that had already
// mounted one (a remount, not a reload), or a draft being handed back to a
// panel that never saved it.
export function reportDeskReset(reason) {
  const trail = deskTrail();
  const chain = trail
    .slice(-8)
    .map((e) => `${e.kind}${e.detail ? `(${e.detail})` : ""}`)
    .join(" → ");
  console.warn(`desk reset: ${reason}${chain ? ` — ${chain}` : ""}`);
  noteDesk("reset", reason);
}

// Whether a Workspace mounting right now is the FIRST one this JavaScript
// context has seen. A second one means the tree was torn down and rebuilt
// without the page reloading, which is the shape of the bug above.
let mounted = 0;
let usedSinceMount = false;
export function noteWorkspaceMount() {
  mounted += 1;
  noteDesk("mount", `#${mounted}`);
  // Only a remount that interrupted WORK is worth a line. React's dev
  // StrictMode mounts every tree twice on purpose, back to back, before a GM
  // has touched anything — warning about that would train everyone to ignore
  // the warning that matters.
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
