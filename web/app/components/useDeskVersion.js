"use client";

import { useSyncExternalStore } from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { readSession, writeSession } from "./useSessionState";

// Client half of deploy awareness (deployVersion.js: server half). `stale`
// LATCHES until clicked. Leave NEXT_SERVER_ACTIONS_ENCRYPTION_KEY unset — pinning it survives a deploy.

const CRUMB_KEY = "gm-desk-version-crumb";

// `baseline`: the build this desk's page rendered from (useRefresh.js).
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

// baseline = the version the page was RENDERED by (a page.js prop).
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
    /* offline, timing out, or mid-switchover — never "reload the page" */
  }
  if (outcome === "stale") latch();
  // Breadcrumb for the mount-time diagnostic line (Workspace.js).
  writeSession(CRUMB_KEY, { at: Date.now(), outcome, baseline, seen: state.lastSeen });
  return outcome;
}

// LiveInboxPoller.js gets the version back in every response, latching without a fetch of its own.
export function noteDeskVersion(seen, baseline) {
  state.lastSeen = seen;
  if (seen !== baseline) latch();
  return state.stale ? "stale" : "ok";
}

// Latches on the FIRST mutation after a deploy, not the next poll. Returns result untouched.
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

// Header chip both desks show once `stale` latches. Accent on an inner span:
// .btn-quiet is unlayered CSS and outranks Tailwind's layered .text-accent.
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

// Catch-path error for every desk mutation. Next answers a stale build's dead
// action ids with UnrecognizedActionError — latch the chip here rather than wait for a poll.
export function mutationErrorMessage(err) {
  if (err && unstable_isUnrecognizedActionError(err)) latch();
  return state.stale
    ? "The desk is running an older version than the server — reload the page, then try again."
    : "Something went wrong on the server — your change may not have saved. Try again.";
}
