"use client";

import { useSyncExternalStore } from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { readSession, writeSession } from "./useSessionState";

// The client half of the desk's deploy awareness (deployVersion.js is the
// server half). Polling calls checkDeskVersion() first and only refresh()es
// on a same-version "ok", so a deploy or a switchover 5xx becomes a skipped
// tick and a quiet chip instead of Next's build-id-mismatch full navigation.
// `stale` LATCHES: once flagged, auto-refresh stands down until the GM clicks
// the chip, since refreshing a stale desk into the new build IS the reload
// being avoided. Leave NEXT_SERVER_ACTIONS_ENCRYPTION_KEY unset — pinning it
// would make stale action ids survive a deploy and reopen the reload.

const CRUMB_KEY = "gm-desk-version-crumb";

// `baseline` is the build this desk's page rendered from, handed in by
// DeskStaleRefreshGate (useRefresh.js) so a mutation result can be judged
// without prop-drilling the version to every call site.
const state = { stale: false, lastSeen: null, baseline: null };
const listeners = new Set();

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function isDeskStale() {
  return state.stale;
}

export function setDeskBaseline(version) {
  state.baseline = version ?? null;
}

function latch() {
  if (state.stale) return;
  state.stale = true;
  for (const callback of listeners) callback();
}

// baseline = the version the page was RENDERED by (a page.js prop), which is
// exactly what the client's own RSC payloads are tied to.
export async function checkDeskVersion(baseline) {
  let outcome = "unreachable";
  try {
    const res = await fetch("/api/desk-version", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const { version } = await res.json();
      state.lastSeen = version;
      outcome = version === baseline ? "ok" : "stale";
    }
  } catch {
    /* offline, timing out, or mid-switchover — all mean "don't refresh now",
       never "reload the page" */
  }
  if (outcome === "stale") latch();
  // Breadcrumb for the mount-time diagnostic line (Workspace.js): after a
  // reload it says whether the last poll before it saw a new build, a dead
  // server, or nothing unusual (= the GM's own ⌘R).
  writeSession(CRUMB_KEY, { at: Date.now(), outcome, baseline, seen: state.lastSeen });
  return outcome;
}

// The live inbox poll (LiveInboxPoller.js) gets the server's version back in
// every response, so it can latch the same flag without a fetch of its own —
// which is how a deploy shows the chip in ~3s instead of waiting on the 30s
// poll's pre-flight check.
export function noteDeskVersion(seen, baseline) {
  state.lastSeen = seen;
  if (seen !== baseline) latch();
  return state.stale ? "stale" : "ok";
}

// Every desk server action hands its build back in the result
// (lib/actionResult.js#guarded). Passing the result through here is what
// latches the chip on the FIRST mutation after a deploy rather than on the
// next poll — the window in which a post-mutation refresh() would have been
// a hard navigation. Returns the result untouched, so a call site reads
// `const res = noteActionVersion(await doThing(...))`.
export function noteActionVersion(result) {
  if (result?.version && state.baseline) noteDeskVersion(result.version, state.baseline);
  return result;
}

export default function useDeskVersion() {
  return useSyncExternalStore(subscribe, isDeskStale, getServerSnapshot);
}

function getServerSnapshot() {
  return false;
}

// The header chip both desks show once a deploy has latched `stale`: the
// desk has stopped auto-refreshing (see DeskStaleRefreshGate above), and
// this is the GM's own door to the new build. Renders nothing until then.
// Accent goes on an inner span: .btn-quiet is unlayered CSS and outranks
// Tailwind's layered .text-accent on the same element (the .panel trap
// globals.css documents).
export function DeskStaleChip() {
  const stale = useDeskVersion();
  if (!stale) return null;
  return (
    <button
      type="button"
      className="btn-quiet"
      onClick={() => window.location.reload()}
      title="A new version deployed. This desk has stopped auto-refreshing; reload picks the new version up. Rail filters, scroll, who you have open and anything typed into a Result box or a reply come back — a half-filled composer does not, so send or stage that first."
    >
      <span className="text-accent">Updated — reload when ready</span>
    </button>
  );
}

// The catch-path error for every desk mutation. A stale build's server
// action rejects with "Failed to find Server Action" (the action ids died
// with the old build); say the true thing when we know the build moved.
// Pass the caught error where there is one. A stale build's action ids died
// with the old build, and Next answers that with UnrecognizedActionError —
// which is proof the server moved on, so latch the chip here rather than
// waiting for a poll to notice. Uncaught, that same error reaches error.js
// and takes the whole column (and everything in useState with it) away.
export function mutationErrorMessage(err) {
  if (err && unstable_isUnrecognizedActionError(err)) latch();
  return state.stale
    ? "The desk is running an older version than the server — reload the page, then try again."
    : "Something went wrong on the server — your change may not have saved. Try again.";
}
