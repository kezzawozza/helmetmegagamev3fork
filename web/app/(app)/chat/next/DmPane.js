"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import DmThread from "@/app/components/DmThread";
import { DM_KIND } from "@lifeweb/db/lib/dmKinds";
import { FeedSkeleton } from "./Feed";
import useNarrow from "../useNarrow";
import EmptyState from "@/app/components/EmptyState";
import IconButton from "@/app/components/IconButton";
import { SendIcon } from "@/app/components/icons";
import useSubmitOnEnter from "@/app/components/useSubmitOnEnter";
import useComposerAutosize from "../useComposerAutosize";
import { PLAYER_DM_MAX_LENGTH } from "@/lib/constants";
import { gmThread, sendToGms } from "../actions";
import { useDmState, seedDmRows, prependDmRows, addDmRow } from "../dmStore";
import { peekSeen, markSeen } from "../seenStore";
import { DM_PLACE_KEY } from "@/lib/dmSources";

// The Bascinet conversation, in Chat: everything the game has ever said
// to this player by DM — turn results, the Bird, a GM's reply — and a box to
// write back into. The same DirectMessage rows the GM desk reads, drawn by
// the desk's own DmThread from the other chair (CHAT.md §2b).
//
// A pseudo-place: it is in the places column and it round-trips through the
// hash, but it has no feed, no seq and no channel.
// What lives here is the page fetch, the reply, and the seen mark.

let optimisticSeq = 0;

// REBUILT (CHAT-REBUILD.md phase 6), and the smallest of the rebuilds: this
// pane was already the shape the vocabulary asks for — one composer row with
// the send inside the box, a foot that only exists when it has something to
// say. So the body below is ../DmPane.js's, unchanged.
//
// What went is the SHELL. The old pane drew its own `.chat-main` and its own
// `ChatHead`, because it replaced the whole centre column; the rebuilt shell
// owns the girder head for every place, and a second head inside it would be
// two names over one scene. `drawers` went with the head — the phone's
// controls live on that bar, which is phase 7's.
export default function DmPane({ self }) {
  const dm = useDmState();
  const [pending, setPending] = useState([]);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef(null);
  useComposerAutosize(textareaRef, draft);
  const [error, setError] = useState(null);
  const [sending, startSending] = useTransition();
  // The first page failed to load — a network blip, or a character that
  // died with the tab open. Drawn as a line and a retry, never as the
  // skeleton forever.
  const [loadError, setLoadError] = useState(null);
  const [retries, setRetries] = useState(0);
  // Where the NEW line goes is decided once, when the pane opens — the same
  // beat the mark moves in, which is why it is peeked here and not read from
  // the store.
  const [newSinceMs] = useState(() => {
    const mark = peekSeen(DM_PLACE_KEY);
    const n = mark ? Number(mark) : NaN;
    return Number.isFinite(n) ? n : null;
  });

  // The first page on open, and again after the tab's stream reconnected —
  // there is no cursor to catch up from, so the page is simply asked for
  // again and the store keeps what it already holds.
  useEffect(() => {
    let cancelled = false;
    gmThread()
      .then((result) => {
        if (cancelled) return;
        if (!result?.ok) {
          setLoadError(result?.error ?? "Couldn't load the conversation.");
          return;
        }
        setLoadError(null);
        seedDmRows(result.rows, result.hasMore);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load the conversation.");
      });
    return () => {
      cancelled = true;
    };
  }, [dm.reconnects, retries]);

  // Reading it is seeing it — while somebody is actually looking. A tab
  // parked on Bascinet overnight must not swallow the turn result's dot: the
  // mark moves only while the document is visible, and again when it
  // becomes visible.
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  useEffect(() => {
    if (visible && dm.newestOutboundMs !== null) markSeen(DM_PLACE_KEY, String(dm.newestOutboundMs));
  }, [dm.newestOutboundMs, visible]);

  const loadOlder = useCallback(() => {
    const first = dm.rows[0];
    if (!first) return;
    gmThread({ beforeId: first.id })
      .then((result) => {
        if (result?.ok) prependDmRows(result.rows, result.hasMore);
      })
      .catch(() => {});
  }, [dm.rows]);

  // A pending row retires the moment its confirmed twin shows up, whichever
  // path brought it — the stream usually wins. Paired by the nonce the send
  // carried, not by text: writing "ok" twice used to retire both pending
  // lines against the first row that came back.
  const messages = useMemo(() => {
    if (pending.length === 0) return dm.rows;
    const settled = new Set(dm.rows.map((row) => row.clientNonce).filter(Boolean));
    const live = pending.filter((p) => !settled.has(p.clientNonce));
    return live.length === 0 ? dm.rows : [...dm.rows, ...live];
  }, [dm.rows, pending]);

  const onKeyDown = useSubmitOnEnter();
  const narrow = useNarrow();

  function send(e) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || content.length > PLAYER_DM_MAX_LENGTH || sending) return;
    setError(null);
    const tempId = `optimistic-${(optimisticSeq += 1)}`;
    const nonce =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `n-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const optimistic = {
      id: tempId,
      clientNonce: nonce,
      direction: "INBOUND",
      content,
      source: "player",
      // Matches the row the server will write. Without it the pending line
      // draws itself as a grey notice for the instant before its twin lands.
      kind: DM_KIND.CONVERSATION,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setPending((prev) => [...prev, optimistic]);
    setDraft("");
    startSending(async () => {
      const result = await sendToGms(content, nonce);
      setPending((prev) => prev.filter((p) => p.id !== tempId));
      if (!result?.ok) {
        // The words come back into the box — unless the player has already
        // started the next line, which is theirs to keep.
        setDraft((current) => (current.trim() ? current : content));
        setError(result?.error ?? "That didn't send. Try again.");
        return;
      }
      addDmRow(result.row);
    });
  }

  const over = draft.length > PLAYER_DM_MAX_LENGTH;
  const nearLimit = draft.length > PLAYER_DM_MAX_LENGTH * 0.9;
  const footError = error ?? (over ? `That is too long — ${PLAYER_DM_MAX_LENGTH} characters at most.` : null);

  return (
    <>
      <div className="chat-feed chat-dm">
        {!dm.seeded && loadError ? (
          <div className="chat-quiet-line">
            <p>{loadError}</p>
            <button type="button" className="btn-quiet" onClick={() => setRetries((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : !dm.seeded ? (
          <FeedSkeleton />
        ) : messages.length === 0 ? (
          <EmptyState>Nothing has been said here yet.</EmptyState>
        ) : (
          <DmThread
            messages={messages}
            perspective="player"
            character={self?.characterId ? { id: self.characterId, name: self.name, avatarVersion: self.avatarVersion } : null}
            onLoadOlder={loadOlder}
            hasMore={dm.hasMore}
            newSinceMs={newSinceMs}
          />
        )}
      </div>

      <form className="chat-composer" onSubmit={send}>
        <div className="field chat-composer-box">
          {/* One row, the way the scene's box is one row: the words and the
              send inside the container rather than the send standing beside
              it. The foot below stays a sibling of the row, so the error and
              the counter still run the box's full width. */}
          <div className="chat-composer-row">
            <textarea
              ref={textareaRef}
              aria-label="Write to Bascinet"
              rows={1}
              value={draft}
              placeholder="Write to Bascinet…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {/* The same send the scene composer draws (./Feed.js): on a phone,
                the 44px accent glyph, because this is the button a thumb aims
                at on every line. It was a bare .icon-btn here — 26px and the
                colour of a quiet control — which made writing to Bascinet the
                fiddliest box in the app on the face most people write from. */}
            <IconButton
              icon={SendIcon}
              label="Send"
              type="submit"
              className={narrow ? "icon-btn chat-send" : "icon-btn chat-composer-send"}
              size={narrow ? "lg" : "sm"}
              disabled={sending || !draft.trim() || over}
            />
          </div>
          {(nearLimit || footError) && (
            <div className="chat-composer-foot">
              {footError ? <span className="chat-composer-error">{footError}</span> : <span />}
              {nearLimit && (
                <span className="mono" data-over={over ? "true" : undefined}>
                  {draft.length} / {PLAYER_DM_MAX_LENGTH}
                </span>
              )}
            </div>
          )}
        </div>
      </form>
    </>
  );
}
