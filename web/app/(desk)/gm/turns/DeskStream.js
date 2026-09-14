"use client";

import { useEffect } from "react";
import { applyDeskPatch } from "./deskStore";
import { deskDraftHeld, subscribeToDeskDrafts } from "./deskDraft";
import { noteDeskVersion } from "@/app/components/useDeskVersion";
import { useRefresh } from "@/app/components/useRefresh";
import { noteDeskStreamUp, noteDeskStreamDown, noteDeskStreamFatal } from "./deskStreamStore";

// The other GMs' half of the adjudication desk — the Move somebody else just
// claimed, the effect somebody staged, the row somebody rejected. The
// payload is the same patch shape a mutation returns
// (web/lib/deskRows.js#deskPatchFor), folded by the same applyDeskPatch(), so
// a stream frame and a button frame are indistinguishable and the store's
// newer-wins rule arbitrates without either side knowing about the other.
// THE BACKSTOP POLL STAYS, at 120s (Workspace.js) — same argument as
// InboxStream.js: a dead stream that still looks alive is the worst failure
// mode. No chime here: a staged effect is not mail.
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// A stream that never once opened is not a blip. After this many failures with
// no `open` in between, say so rather than retrying behind a silent desk.
const FATAL_AFTER = 4;

const DRAFT_KEY = { moves: (row) => `move:${row.id}`, cavingRolls: (row) => `caving:${row.id}` };

// A row whose work is FINISHED is never buffered — nothing left for the GM
// to write. MoveDesk drops its draft when the Solved row lands. A Caving
// roll isn't in here on purpose: its Result box stays editable after resolve (CavingDesk.js).
const TERMINAL = { moves: (row) => row.reviewStatus === "SOLVED", cavingRolls: () => false };

function buffers(field, row) {
  if (TERMINAL[field](row)) return false;
  return deskDraftHeld(DRAFT_KEY[field](row));
}

// Split a frame into what can land now and what has to wait.
// THE DIRTY GUARD: a GM typing into a Move's Result box must not have the
// rest of the card swap under them (their TEXT is already safe — the draft
// wins over the row, deskDraft.js). A frame carrying a row with a held draft
// is buffered, folded in when the draft clears (save/solve/reject).
// REMOVALS ARE NEVER BUFFERED — if another GM rejected the Move, say so at
// once rather than let a GM write a result for a row that no longer exists.
function split(patch) {
  let held = null;
  let fold = patch;
  for (const field of Object.keys(DRAFT_KEY)) {
    const rows = patch[field];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const keep = rows.filter((row) => !buffers(field, row));
    if (keep.length === rows.length) continue;
    if (fold === patch) fold = { ...patch };
    // Turn stamp rides along so a buffered frame is still judged against its own turn when it lands (deskStore.js).
    held = held ?? { asOfMs: patch.asOfMs, turnId: patch.turnId };
    held[field] = rows.filter((row) => buffers(field, row));
    fold[field] = keep;
  }
  return { fold, held };
}

export default function DeskStream({ deployVersion }) {
  const [refresh] = useRefresh();

  useEffect(() => {
    let source = null;
    let stopped = false;
    let failures = 0;
    let everOpened = false;
    let reconnectTimer = null;
    // Array, not one merged patch: each carries its own asOfMs — merging is the store's job, not this file's.
    let buffered = [];

    function drain() {
      if (buffered.length === 0) return;
      const waiting = buffered;
      buffered = [];
      for (const patch of waiting) {
        const { fold, held } = split(patch);
        applyDeskPatch(fold);
        if (held) buffered.push(held);
      }
    }

    function fold(data) {
      if (data?.version) noteDeskVersion(data.version, deployVersion);
      const { fold: now, held } = split(data);
      applyDeskPatch(now);
      if (held) buffered.push(held);
    }

    function openStream() {
      if (stopped || source) return;
      const es = new EventSource("/api/gm/desk-stream");
      source = es;

      es.addEventListener("open", () => {
        everOpened = true;
        failures = 0;
        noteDeskStreamUp();
      });

      es.addEventListener("desk", (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        fold(data);
      });

      es.addEventListener("resync", (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          data = null;
        }
        if (data?.version) noteDeskVersion(data.version, deployVersion);
        // The hub's Postgres connection dropped and came back; unlike the
        // inbox there's no cursor to re-ask from, so the page is refetched
        // once. Mounted inside DeskStaleRefreshGate, so `refresh()` is already guarded against a deploy-window hard navigation.
        refresh();
      });

      es.addEventListener("error", () => {
        // A 204 closes without firing `open` — signed out or no longer a GM.
        es.close();
        if (source === es) source = null;
        if (stopped) return;
        failures += 1;
        noteDeskStreamDown(failures);
        if (!everOpened && failures >= FATAL_AFTER) {
          noteDeskStreamFatal();
          return;
        }
        scheduleReconnect();
      });
    }

    function scheduleReconnect() {
      if (stopped || reconnectTimer) return;
      const base = Math.min(RECONNECT_MIN_MS * 2 ** (failures - 1), RECONNECT_MAX_MS);
      // Jitter, so GMs whose streams dropped together don't all reconnect at once.
      const wait = base / 2 + Math.random() * (base / 2);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openStream();
      }, wait);
    }

    function onWake() {
      if (document.visibilityState !== "visible") return;
      // Coming back to the tab: the error handler's backoff may be minutes out. Retry now.
      if (!source && !stopped) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        openStream();
      }
    }

    // Every draft write/clear lands here — a clear is markClean() by another name, saying WHICH row went clean.
    const unsubscribeDrafts = subscribeToDeskDrafts(drain);

    openStream();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("pageshow", onWake);

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      source?.close();
      unsubscribeDrafts();
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, [deployVersion, refresh]);

  return null;
}
