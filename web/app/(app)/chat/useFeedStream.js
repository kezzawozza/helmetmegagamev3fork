"use client";

import { useEffect } from "react";
import { DM_PLACE_KEY } from "@/lib/dmSources";
import { mentionsCharacter } from "@/app/components/richTokens";
import { textNamesCharacter } from "@lifeweb/db/lib/mentions";
import { addDmRow, noteDmReconnect } from "./dmStore";
import { noteTyping } from "./typingStore";
import { noteNotified } from "./notifiedStore";
import { noteStreamUp, noteStreamDown, noteStreamFatal } from "./streamStore";
import { setPlaces, applyRow, removeRow, isOwnRow, resetHistory } from "./feedStore";

// THE LIVE STREAM, lifted out of ./Chat.js whole (CHAT-REBUILD.md).
//
// Not rewritten, and deliberately so. Every paragraph of the comment below is
// an outage or a page-jump somebody chased down, and the whole of it was
// sitting in the middle of a component's layout — which is why the rebuild's
// plan calls this the piece to "split with care". Lifting it here is the
// split: the same effect, the same order, the same names, now callable by
// both the live chat and the rebuilt one instead of forked into two copies
// that drift.
//
// What it takes is what it could not reach from a module: the seq the page
// was rendered at, who is reading, a ref holding the open place, the ref that
// says whether the stream has announced a list yet, the shared refresh, and
// two callbacks for the things that are a component's business — bumping the
// members strip and answering a gap.

// The stream's own reconnect: a second after the first drop, doubling to half
// a minute, with a little jitter so a hundred tabs cut off by one redeploy do
// not all come back on the same tick.
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export default function useFeedStream({
  mountSeq,
  self,
  // Which place is open, read inside the handlers. A REF rather than a
  // dependency: the EventSource opens once per mount, and making the open
  // place a dependency would tear the connection down on every click.
  selectedRef,
  // Written from the `places` handler only, never during a render — ./Chat.js
  // and next/ChatNext.js both read it to decide whether server props may
  // still seed the list.
  streamSpokeRef,
  refresh,
  bumpPlacesVersion,
  onGap,
}) {
  // One stream for the tab, opened once per mount and kept across every
  // refresh. `since` is the seq the page was rendered at, so the first
  // catch-up carries what happened while the page was loading and nothing
  // that was already in it; every reconnect after that asks from the newest
  // seq THIS stream has delivered, so it carries the gap and nothing else.
  //
  // The reconnect is the tab's own, not the browser's. An EventSource that
  // retries by itself replays the URL it was opened with — the page-load seq
  // — and the server's catch-up is capped, so after a long session a
  // browser-driven retry could never reach the rows it had actually missed.
  // So the `error` handler closes it and opens a new one from the cursor,
  // backing off from a second to half a minute; a tab coming back to the
  // front, or the network coming back, reopens at once.
  //
  // Why this used to jump the page: the stream was reopened on every refresh,
  // a reconnect re-announced the place list, and that announce refreshed the
  // page — which reopened the stream. Now a `places` frame refreshes the
  // right column only when the server says the character's own presence
  // moved (`reason: "presence"`), or when a reconnect finds the list changed
  // under it — never for a reconnect that found nothing new.
  useEffect(() => {
    let disposed = false;
    let source = null;
    let timer = null;
    // Consecutive failures, and how many connections have opened on this
    // mount. A drop says nothing about WHY — an EventSource reports no
    // status — so from the second failure on, the tab asks the plain places
    // route before trying again: a 401 there is a session that has expired,
    // and retrying that forever would only be noise in the server log; a 200
    // or no answer at all is the server or the network, and worth waiting for.
    let failures = 0;
    let opens = 0;
    let fatal = false;
    // Whether this streak of failures has been checked against the session
    // yet, and whether that check is out right now — `wake` must not open a
    // stream underneath it.
    let probed = false;
    let probing = false;
    // The newest seq this stream has DELIVERED — the same high-water mark the
    // server keeps for the connection. Not the store's newest: a history
    // fetch fills one place far past another's unread rows, and a summary row
    // can legitimately sit below every street row (the two wipe floors), so
    // the store's maximum is not a claim about every place at once. This is.
    let cursor = mountSeq;

    const noteSeq = (seq) => {
      try {
        if (BigInt(seq) > BigInt(cursor)) cursor = String(seq);
      } catch {
        // A seq that is not a number is not a cursor.
      }
    };

    // Is the session still good? Asked once per streak of failures, from the
    // second one on, and only its status is read — `?probe=1` answers off the
    // session alone (web/app/api/feed/places/route.js).
    const sessionGone = async () => {
      try {
        const res = await fetch("/api/feed/places?probe=1", { cache: "no-store" });
        return res.status === 401 || res.status === 403;
      } catch {
        return false;
      }
    };

    const schedule = () => {
      if (disposed || fatal || timer) return;
      const base = Math.min(RECONNECT_MIN_MS * 2 ** Math.max(0, failures - 1), RECONNECT_MAX_MS);
      const wait = base + Math.floor(Math.random() * RECONNECT_MIN_MS);
      timer = setTimeout(async () => {
        timer = null;
        if (failures >= 2 && !probed) {
          probed = true;
          probing = true;
          const gone = await sessionGone();
          probing = false;
          if (disposed) return;
          // A wake got there first and the stream is back up: nothing to do.
          if (source && source.readyState !== EventSource.CLOSED) return;
          if (gone) {
            fatal = true;
            noteStreamFatal();
            return;
          }
        }
        connect();
      }, wait);
    };

    // The tab is back in front, or the network is back: no reason to sit out
    // the rest of a backoff.
    const wake = () => {
      if (disposed || fatal || probing) return;
      if (document.visibilityState !== "visible") return;
      if (source && source.readyState !== EventSource.CLOSED) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      connect();
    };

    function connect() {
      if (disposed || fatal) return;
      source?.close();
      source = new EventSource(`/api/feed?since=${encodeURIComponent(cursor)}`);

      source.addEventListener("open", () => {
        failures = 0;
        probed = false;
        opens += 1;
        noteStreamUp();
        // The DM path has no seq to catch up from, so a reconnect tells the
        // pane to ask for its page again. The FIRST open is the page's own
        // load.
        if (opens > 1) noteDmReconnect();
      });
      source.addEventListener("error", () => {
        if (disposed) return;
        // Closed here rather than left to retry itself: the browser would
        // reuse the page-load cursor (see above).
        source?.close();
        failures += 1;
        noteStreamDown(failures);
        schedule();
      });
      source.addEventListener("message", (event) => {
        try {
          const row = JSON.parse(event.data);
          if (row?.seq) noteSeq(row.seq);
          applyRow(row.placeKey, row);
          // Somebody spoke in the conversation or private room that is OPEN.
          // A `places` frame only ever fires for the VIEWER's own presence, so
          // nothing else here tells them that a third party was let in or shown
          // out; the next thing anybody says is the cheapest honest prompt to
          // re-read the strip. Only for the two kinds of place that have one.
          const key = row.placeKey;
          if (
            key &&
            key === selectedRef.current &&
            (key.startsWith("conv:") || key.startsWith("room:"))
          ) {
            bumpPlacesVersion();
          }
          // Somebody said your name. Two spellings count: the explicit
          // `{char:…}` token, which is what a picked mention is made of on both
          // faces (CHAT.md §5), and a BARE name, which is what nine lines out of
          // ten actually use (db/lib/mentions.js, REDESIGN.md §6). Never your own
          // words, and never your real name while you are hooded — under a hood
          // the room does not know that name is yours, so being pinged by it
          // would be the hood confirming itself.
          if (
            self?.characterId &&
            !isOwnRow(row, self.characterId, self.speakerKey) &&
            typeof row.content === "string" &&
            row.source !== "SYSTEM" &&
            (mentionsCharacter(row.content, self.characterId) ||
              (!self.aliased && self.name && textNamesCharacter(row.content, self.name)))
          ) {
            // The count, unless they are already looking at the place — Discord
            // clears on read, so raising a number on a scene under somebody's
            // eyes only gives them something to dismiss. The notification itself
            // is refused while the tab is in front (./notifiedStore.js).
            const reading = key === selectedRef.current && document.visibilityState === "visible";
            if (!reading) {
              noteNotified(key, {
                title: `${self.name ?? "You"} was named`,
                body: row.name ? `${row.name} said your name` : "Somebody said your name",
              });
            }
          }
        } catch {
          // A malformed frame is not worth tearing the stream down over.
        }
      });
      // Somebody is writing something, here or on Discord. Held for six seconds
      // by typingStore.js and never sent for the viewer's own character.
      source.addEventListener("typing", (event) => {
        try {
          noteTyping(JSON.parse(event.data));
        } catch {
          // Same.
        }
      });
      // A delete carries only a seq and its place: the words somebody took back
      // never come back down the wire.
      source.addEventListener("delete", (event) => {
        try {
          const data = JSON.parse(event.data);
          removeRow(data?.placeKey, data?.seq);
        } catch {
          // Same.
        }
      });
      // Their feet moved, a key turned, or somebody let them into a
      // conversation — or a connection opened and said where they are. The
      // server has already resubscribed; this is the column catching up.
      source.addEventListener("places", (event) => {
        try {
          const data = JSON.parse(event.data);
          const changed = setPlaces(data?.places ?? []);
          streamSpokeRef.current = true;
          // The members strip re-reads on this: a key turning, or somebody
          // else's /add, is exactly what a places frame means — and after a
          // reconnect it is the one thing that can tell the strip who was
          // let into the open room while the tab was away.
          bumpPlacesVersion();
          // The right column is server props off page.js (where you are, who
          // is here, the Examine lines, the rooms a Transfer can reach), and
          // nothing else refreshes them, so a walk across town has to. Only
          // when the server says the VIEWER's own presence moved — that frame
          // fires for a web-only toggle too, which changes the column and not
          // the list — or when a reconnect found the list changed under it.
          // A reconnect that re-announces the same list refreshes nothing.
          // Through the shared transition, so the page never drops to its
          // loading skeleton for the length of the refetch (useRefresh.js).
          if (data?.reason === "presence" || (opens > 1 && changed)) refresh();
        } catch {
          // Same.
        }
      });
      // The reconnect's catch-up was too long to replay row by row
      // (web/app/api/feed/route.js). Every place is re-read from the history
      // route instead: the selection effect and the prefetch below do that
      // on their own once the store says nothing is loaded.
      source.addEventListener("gap", () => {
        resetHistory();
        onGap();
      });
      // A DM for this account — Bascinet's turn result, a GM's reply, or the
      // line this tab just sent, coming back round (dmStore.js dedupes by id).
      source.addEventListener("dm", (event) => {
        try {
          const row = JSON.parse(event.data);
          // The hub's pg client came back from a drop (feedHub.js#resyncDm):
          // not a row, a prompt to fetch the page again.
          if (row?.resync) {
            noteDmReconnect();
            return;
          }
          addDmRow(row);
          // Quiet only while the pane is open AND somebody is looking at it.
          const reading = selectedRef.current === DM_PLACE_KEY && document.visibilityState === "visible";
          if (row?.direction === "OUTBOUND" && !reading) {
            // A line in your Bascinet mail is a notified event by definition —
            // it was written to you and to nobody else (REDESIGN.md §6).
            noteNotified(DM_PLACE_KEY, { title: "Bascinet wrote to you", body: "Open Chat to read it" });
          }
        } catch {
          // Same.
        }
      });
    }

    connect();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    return () => {
      // `disposed` first: a StrictMode double-mount runs this cleanup and
      // then the effect again, and a timer left ticking from the first run
      // would open a second stream beside the second run's.
      disposed = true;
      if (timer) clearTimeout(timer);
      source?.close();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, [mountSeq, self?.characterId, self?.speakerKey, self?.aliased, self?.name, refresh, selectedRef, streamSpokeRef, bumpPlacesVersion, onGap]);
}
