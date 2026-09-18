"use client";

import { useEffect, useRef } from "react";
import { useSelection } from "./selection";
import { applyDelta, getCursorMs } from "./liveInbox";
import { noteDeskVersion } from "@/app/components/useDeskVersion";
import { noteInboxStreamUp, noteInboxStreamDown, noteInboxStreamFatal } from "./inboxStreamStore";

// The fast path of the player desk, pushed rather than polled. Replaces a
// setTimeout chain hitting /api/gm/inbox-delta every three seconds. Payload
// unchanged — same delta frames (web/app/api/gm/inbox-stream/route.js, over
// web/lib/inboxDelta.js), folded by the same applyDelta(); only the trigger
// moved. THE BACKSTOP POLL STAYS, at 30s instead of 3s (PLAYER-DESK.md §9a):
// a dead stream that still looks alive is the worst failure mode, so the
// poll keeps the desk correct while inboxStreamStore.js flags it. Still a
// plain GET either way — router.refresh()'s build-mismatch hazard is InboxPoller's job.
const BACKSTOP_MS = 30_000;
const BACKSTOP_TIMEOUT_MS = 8_000;
// Reconnect is the TAB's job, not EventSource's — its own retry replays the
// original URL, pinning `since` to a stale cursor. Same reasoning as chat/Chat.js.
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// After this many failures with no `open` in between, say so rather than retrying behind a silent desk.
const FATAL_AFTER = 4;

export default function InboxStream({ deployVersion }) {
  const segment = useSelection();

  // Read at fire time through a ref — as an effect dependency, a click on a
  // different person would tear the EventSource down and reconnect.
  const segmentRef = useRef(segment);
  useEffect(() => {
    segmentRef.current = segment;
  }, [segment]);

  useEffect(() => {
    let source = null;
    let stopped = false;
    let failures = 0;
    let everOpened = false;
    let reconnectTimer = null;
    let backstopTimer = null;
    let backstopInFlight = null;

    // One delta in, folded. Shared by the stream and backstop so the two can't drift.
    function fold(data) {
      if (data?.version) noteDeskVersion(data.version, deployVersion);
      applyDelta(data);
    }

    // ---- the stream -------------------------------------------------------

    function openStream() {
      if (stopped || source) return;
      const params = new URLSearchParams();
      const cursor = getCursorMs();
      if (cursor > 0) params.set("since", String(Math.floor(cursor)));

      const es = new EventSource(`/api/gm/inbox-stream?${params}`);
      source = es;

      es.addEventListener("open", () => {
        everOpened = true;
        failures = 0;
        noteInboxStreamUp();
      });

      es.addEventListener("delta", (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        fold(data);
      });

      es.addEventListener("error", () => {
        // A 204/401 closes without firing `open` — signed out or no longer a GM.
        es.close();
        if (source === es) source = null;
        if (stopped) return;
        failures += 1;
        noteInboxStreamDown(failures);
        if (!everOpened && failures >= FATAL_AFTER) {
          noteInboxStreamFatal();
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

    // ---- the backstop -----------------------------------------------------

    async function backstopTick() {
      if (stopped || backstopInFlight) return;
      const params = new URLSearchParams();
      const cursor = getCursorMs();
      if (cursor > 0) params.set("since", String(Math.floor(cursor)));
      if (segmentRef.current) params.set("open", segmentRef.current);
      // Ask for the open thread outright — the one slow tick is where it gets repaired.
      params.set("full", "1");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BACKSTOP_TIMEOUT_MS);
      backstopInFlight = controller;
      try {
        const res = await fetch(`/api/gm/inbox-delta?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (res.status === 204) {
          stopped = true;
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        fold(data);
      } catch {
        // Offline, timing out, mid-switchover — all "try again later"; cursor stays put.
      } finally {
        clearTimeout(timeout);
        backstopInFlight = null;
      }
    }

    // ---- wiring -----------------------------------------------------------

    function onWake() {
      if (document.visibilityState !== "visible") return;
      // Coming back to the tab: the error handler's backoff may be minutes out. Retry now.
      if (!source && !stopped) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        openStream();
      }
      void backstopTick();
    }

    openStream();
    backstopTimer = setInterval(backstopTick, BACKSTOP_MS);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("pageshow", onWake);

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      clearInterval(backstopTimer);
      backstopInFlight?.abort();
      source?.close();
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("pageshow", onWake);
    };
    // `segment` is deliberately NOT a dependency — see segmentRef above.
  }, [deployVersion]);

  return null;
}
