"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import DmThread from "@/app/components/DmThread";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import DevPanelModal from "@/app/components/DevPanelModal";
import ZoneChip from "@/app/components/ZoneChip";
import { EnumPill, CHARACTER_STATUS } from "@/app/components/StatusPill";
import useSubmitOnEnter from "@/app/components/useSubmitOnEnter";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import IconButton from "@/app/components/IconButton";
import { SendIcon } from "@/app/components/icons";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { useThreadFeed, noteConversationRead } from "../liveInbox";
import {
  sendGmDm,
  markConversationRead,
  claimConversation,
  releaseConversation,
} from "../actions";
import { useDmDraft, writeDmDraft, dmDraftFresh } from "../dmDraft";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { selectConversation } from "../selection";
import { dialogHoldsKeyboard } from "@/app/components/Modal";

// The centre column: a real chat pane, not a thread block in document flow.
// The transcript scrolls inside itself; the composer pins to the bottom.
let optimisticSeq = 0;

// One id per send, minted before the send and kept across a Retry — pairs
// the optimistic line with the row that comes back, and makes Retry safe:
// the server finds the nonce already on the table and returns that row instead of a second copy.
function mintNonce() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function ConversationPane({
  discordUserId,
  label,
  // The Discord handle behind `label`, from /api/gm/thread. Separate from the
  // label because the label is also the avatar's alt name.
  username = null,
  characterId,
  avatarVersion,
  zoneName,
  status,
  moveId,
  initialMessages,
  initialHasMore,
  gmProfiles,
  myDiscordUserId,
  claimedByDiscordUserId,
  lastReadAtMs = 0,
}) {
  // The parent page keys this component on `discordUserId`, so a
  // conversation switch remounts it and resets this state.
  const [pages, setPages] = useState({ messages: initialMessages, hasMore: initialHasMore });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [claimedBy, setClaimedBy] = useState(claimedByDiscordUserId);
  const lastMarkedIdRef = useRef(null);
  // The Dev Panel open as a modal, or null — mirrors RosterTable.js and
  // Workspace.js: opening it never navigates away.
  const [devPanelOpen, setDevPanelOpen] = useState(false);

  // Held in memory, mirrored to localStorage where there's room (../dmDraft). Typing never depends on the mirror succeeding.
  const content = useDmDraft(discordUserId);
  // An unsent reply counts as unsaved work, so the desk's gated poll stands
  // down (isAnyDirty). `enabled: false` leaves the beforeunload prompt off —
  // the draft is mirrored to storage and comes back after a reload, so "are
  // you sure" would warn about nothing. Only holds the poll down while
  // somebody is ACTUALLY WRITING, same 10-minute rule as the adjudication
  // desk's Result box (useDirtyGuard.js#alsoDirtyHoldsPoll, deskDraft.js).
  useDirtyGuard({
    enabled: false,
    alsoDirty: content.trim().length > 0,
    alsoDirtyHoldsPoll: dmDraftFresh(discordUserId),
  });

  // What the live poll has brought in since the page was seeded
  // (liveInbox.js), unioned with the server page during render, never
  // copied into state. A pending optimistic row retires the moment the real
  // row shows up, whichever path delivers it first.
  const feed = useThreadFeed(discordUserId);
  const displayed = useMemo(() => {
    const byId = new Map();
    for (const m of pages.messages) byId.set(m.id, m);
    for (const m of feed) if (!byId.has(m.id)) byId.set(m.id, m);
    // Retired by NONCE, not text — matching on content retired both placeholders on a double "ok" send.
    const settled = new Set(
      [...byId.values()].filter((m) => !m.pending && m.clientNonce).map((m) => m.clientNonce),
    );
    return [...byId.values()]
      .filter((m) => !(m.pending && m.clientNonce && settled.has(m.clientNonce)))
      .sort((a, b) => {
        const d = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
  }, [pages.messages, feed]);

  const writeDraft = useCallback((value) => writeDmDraft(discordUserId, value), [discordUserId]);

  // The composer grows one line to ten, then scrolls — measured in the change handler, not an effect.
  const composerRef = useRef(null);
  const fitComposer = useCallback((el) => {
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(window.getComputedStyle(el).lineHeight) || 20;
    const max = line * 10 + 16;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, []);

  // Mark-read: fires from a client effect after mount and on a new INBOUND
  // id — NEVER during RSC render, which would mark-on-hover under Next's
  // link prefetch. Only while visible, de-duplicated via the ref.
  useEffect(() => {
    const newest = displayed[displayed.length - 1];
    if (!newest) return;
    // Neither an optimistic nor a failed row is a real message yet.
    if (newest.pending || newest.failed) return;
    if (lastMarkedIdRef.current === newest.id) return;
    if (document.visibilityState !== "visible") return;
    lastMarkedIdRef.current = newest.id;
    // Said locally FIRST, so badges clear on open (liveInbox.js#noteConversationRead), then again with the server's real cursor.
    noteConversationRead(discordUserId, Date.now());
    markConversationRead({ playerDiscordUserId: discordUserId }).then((result) => {
      if (result?.ok && Number.isFinite(result.lastReadAtMs)) {
        // `fromServer` REPLACES the Date.now() guess — a fast browser clock would otherwise strand its own over-claim.
        noteConversationRead(discordUserId, result.lastReadAtMs, { fromServer: true });
      }
    });
  }, [displayed, discordUserId]);

  // The GET route, not a server action — a click shouldn't queue behind
  // paging, same reason the rail's search moved (api/gm/conversation-search).
  async function loadOlder() {
    const oldest = pages.messages[0];
    if (!oldest) return;
    const params = new URLSearchParams({
      user: discordUserId,
      beforeMs: String(new Date(oldest.createdAt).getTime()),
      beforeId: oldest.id,
    });
    try {
      const res = await fetch(`/api/gm/thread?${params}`, { cache: "no-store" });
      if (res.status === 204 || !res.ok) return; // res.ok is true for a 204, so test it by hand
      const result = await res.json();
      setPages((prev) => ({
        messages: [...result.messages, ...prev.messages],
        hasMore: result.hasMore,
      }));
    } catch {
      // Offline or a switchover — the sentinel stays, so scrolling up again retries.
    }
  }

  // Send is optimistic: the row appears and the draft clears instantly.
  // A failure no longer takes the row away and refills the box — the draft
  // is shared with whatever's typed next, so that overwrote a sentence in
  // progress. The failed line stays with Retry and Discard; Retry reuses
  // the nonce, so a send whose ANSWER got lost cannot land twice — the row
  // is already on the table and sendGmDm hands it back instead of posting again.
  //
  // One window this doesn't cover: the nonce is written when the DM is
  // LOGGED, after the Discord POST (web/lib/discordGuild.js#sendDm). A send
  // that reached Discord and then lost its log write leaves no row for
  // Retry to find, so Retry posts a second copy. Closing it means reserving
  // the nonce before the POST, a change to all three sendDm transports, not made here.
  const deliver = useCallback(
    (message, tempId, nonce) => {
      startTransition(async () => {
        // try/catch, not just `ok`: an action REJECTS when the request never
        // completes at all — left unhandled the row sat pending forever.
        let result;
        try {
          result = await sendGmDm({ discordUserId, content: message, clientNonce: nonce });
        } catch {
          result = { ok: false, error: "That didn't send — you may be offline." };
        }
        if (!result.ok) {
          setPages((prev) => ({
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === tempId ? { ...m, pending: false, failed: true, error: result.error } : m,
            ),
          }));
          setError(result.error);
          return;
        }
        // The action returns the fresh tail page too — the only path that
        // brings in what the PLAYER said since this pane mounted. MERGE it:
        // the GM may have paged back hundreds of messages with loadOlder,
        // and replacing the array would snap them to the last 100.
        setPages((prev) => {
          const kept = prev.messages.filter((m) => m.id !== tempId);
          if (!Array.isArray(result.messages)) {
            return {
              ...prev,
              messages: prev.messages.map((m) => (m.id === tempId ? (result.message ?? { ...m, pending: false }) : m)),
            };
          }
          const have = new Set(kept.map((m) => m.id));
          const fresh = result.messages.filter((m) => !have.has(m.id));
          return { ...prev, messages: [...kept, ...fresh] };
        });
      });
    },
    [discordUserId],
  );

  function handleSend(e) {
    e.preventDefault();
    const message = content.trim();
    if (!message || message.length > GM_MESSAGE_MAX_LENGTH) return;
    setError(null);

    const tempId = `optimistic-${(optimisticSeq += 1)}`;
    const nonce = mintNonce();
    const optimistic = {
      id: tempId,
      clientNonce: nonce,
      discordUserId,
      direction: "OUTBOUND",
      // Matches what sendDm writes, so the row doesn't reflow when replaced.
      // `sentText` is kept so Retry resends exactly it — deriving it back
      // from `content` meant stripping a leading "» ", losing a deliberate one.
      sentText: message,
      content: `» ${message}`,
      authorDiscordUserId: myDiscordUserId,
      source: "gm_reply",
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setPages((prev) => ({ ...prev, messages: [...prev.messages, optimistic] }));
    writeDraft("");
    if (composerRef.current) {
      composerRef.current.value = "";
      fitComposer(composerRef.current);
    }

    deliver(message, tempId, nonce);
  }

  // Retry sends the same words under the same nonce, from `sentText`. Fallback is for a row from before that field existed.
  const retrySend = useCallback(
    (row) => {
      setError(null);
      setPages((prev) => ({
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === row.id ? { ...m, pending: true, failed: false, error: null } : m,
        ),
      }));
      deliver(row.sentText ?? row.content.replace(/^» /, ""), row.id, row.clientNonce);
    },
    [deliver],
  );

  const discardSend = useCallback((row) => {
    setPages((prev) => ({ ...prev, messages: prev.messages.filter((m) => m.id !== row.id) }));
  }, []);

  function toggleClaim() {
    startTransition(async () => {
      if (claimedBy === myDiscordUserId) {
        await releaseConversation({ playerDiscordUserId: discordUserId });
        setClaimedBy(null);
      } else {
        await claimConversation({ playerDiscordUserId: discordUserId });
        setClaimedBy(myDiscordUserId);
      }
    });
  }

  // Escape leaves the conversation for the roster, layered topmost-first
  // (Workspace.js): 1) an open Modal owns Escape — yield. 2) a focused
  // input/textarea/select — blur it, so mid-sentence Escape doesn't throw
  // the GM out; a second Escape then leaves. 3) otherwise close the
  // conversation, a state change (selection.js), not a navigation. Unlike
  // /gm/turns, leaving here is a step back to the list, not off the whole
  // desk — the rail never leaves the screen. Non-destructive either way:
  // the draft is mirrored to storage (dmDraft.js).
  const coarse = useIsCoarsePointer();
  useEffect(() => {
    if (coarse) return undefined; // no Escape key on a touch-primary device

    function onKey(e) {
      if (e.key !== "Escape") return;
      if (dialogHoldsKeyboard()) return;
      const active = document.activeElement;
      if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) {
        active.blur();
        return;
      }
      selectConversation(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coarse]);

  const onKeyDown = useSubmitOnEnter();

  // Focus the composer the moment a conversation opens. Mount-only is
  // right: a poll tick can't steal focus mid-sentence since it doesn't
  // remount. Skipped on touch — popping the keyboard would be worse than a tap.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    fitComposer(el);
    if (coarse) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length); // caret at end after a restored draft
  }, [coarse, fitComposer]);

  const over = content.length > GM_MESSAGE_MAX_LENGTH;
  const nearLimit = content.length > GM_MESSAGE_MAX_LENGTH * 0.9;
  const claimedByOther = claimedBy && claimedBy !== myDiscordUserId;
  const sendHint = coarse ? "Send" : "Send — Enter sends, Shift+Enter for a new line";

  return (
    <div className="desk-convo">
      <div className="desk-convo-head">
        <div className="flex items-center gap-2 min-w-0">
          {/* Narrow tiers only: the roster isn't on screen beside this. Same destination as Esc. */}
          <button
            type="button"
            className="btn-quiet desk-back"
            title="Back to the roster"
            onClick={() => selectConversation(null)}
          >
            ← Back
          </button>
          <CharacterAvatar characterId={characterId} name={label} version={avatarVersion} size={32} zoomable />
          {/* The character, then the account behind them. Two elements rather
              than one composed string so the handle can be drawn quiet — and so
              the name is still the thing that survives the truncate. */}
          <h2 className="section-title truncate">{label}</h2>
          {username && <span className="text-xs text-muted truncate">(@{username})</span>}
          {zoneName ? <ZoneChip zoneName={zoneName} /> : null}
          {status && <EnumPill map={CHARACTER_STATUS} value={status} />}
        </div>
        <div className="flex items-center gap-2">
          {moveId && (
            <Link href={`/gm/turns?sel=move/${moveId}`} className="btn-quiet">
              Adjudicate →
            </Link>
          )}
          <DevCharacterButton
            characterId={characterId}
            name={label}
            onOpen={() => setDevPanelOpen(true)}
          />
          {/* Fixed width: the three labels differ in length, jumping everything left of it on each claim change. */}
          <button
            type="button"
            className="btn-quiet text-center"
            style={{ width: "11rem" }}
            disabled={claimedByOther || pending}
            onClick={toggleClaim}
          >
            {claimedBy
              ? claimedByOther
                ? "Claimed by another GM"
                : "Release claim"
              : "Claim conversation"}
          </button>
          {/* Twin of the Escape key handler above — a close mark, not a keycap label; the key is still said in the tooltip. */}
          <button
            type="button"
            className="btn-quiet"
            title="Close — or press Esc"
            aria-label="Close this conversation"
            onClick={() => selectConversation(null)}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="desk-convo-thread">
        {displayed.length === 0 ? (
          <p className="text-sm text-muted p-4">
            No messages yet. Whatever you send first opens the conversation.
          </p>
        ) : (
          <DmThread
            messages={displayed}
            gmProfiles={gmProfiles}
            onLoadOlder={loadOlder}
            hasMore={pages.hasMore}
            character={characterId ? { id: characterId, name: label, avatarVersion, username } : null}
            newSinceMs={lastReadAtMs}
            myDiscordUserId={myDiscordUserId}
            onRetry={retrySend}
            onDiscard={discardSend}
          />
        )}
      </div>

      <form className="desk-convo-composer" onSubmit={handleSend}>
        <div className="desk-convo-box">
          <label className="field min-w-0 flex-1">
            <span className="sr-only">Reply</span>
            <textarea
              ref={composerRef}
              rows={1}
              value={content}
              onChange={(e) => {
                writeDraft(e.target.value);
                fitComposer(e.target);
              }}
              onKeyDown={onKeyDown}
              placeholder={`Message ${label}`}
              title={coarse ? undefined : "Enter sends, Shift+Enter for a new line"}
            />
          </label>
          <IconButton
            icon={SendIcon}
            label={sendHint}
            type="submit"
            disabled={pending || !content.trim() || over}
          />
        </div>
        {(nearLimit || error) && (
          <div className="flex items-center justify-between gap-2">
            {error ? (
              <p className="text-sm" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            ) : (
              <span />
            )}
            {nearLimit && (
              <span className="text-xs mono" style={over ? { color: "var(--danger)" } : { color: "var(--muted)" }}>
                {content.length} / {GM_MESSAGE_MAX_LENGTH}
              </span>
            )}
          </div>
        )}
      </form>

      {devPanelOpen && (
        <DevPanelModal
          characterId={characterId}
          name={label}
          onClose={() => setDevPanelOpen(false)}
        />
      )}
    </div>
  );
}
