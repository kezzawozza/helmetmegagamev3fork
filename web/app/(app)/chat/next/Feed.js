"use client";

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import EmptyState from "@/app/components/EmptyState";
import FormError from "@/app/components/FormError";
import Modal from "@/app/components/Modal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { Readout } from "@/app/components/ExamineDialog";
import LookReadout from "@/app/components/LookReadout";
import IconButton from "@/app/components/IconButton";
import TranscriptLine from "@/app/components/TranscriptLine";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import { CameraIcon, EditIcon, EyeIcon, MoreIcon, NotesIcon, TrashIcon } from "@/app/components/icons";
import { formatTurnLabel } from "@/lib/turnFormat";
import { DECREE_LABEL, splitDecree } from "@lifeweb/db/lib/decreeText";
import MembersStrip from "../MembersStrip";
import usePlaceMembers from "../usePlaceMembers";
import FeedSearch from "../FeedSearch";
import { photographRow, starRow, lookAtRow } from "../actions";
import {
  useFeed,
  useHistoryState,
  useBacklog,
  backlogOf,
  setBacklog,
  seedRows,
  oldestSeq,
  isOwnRow,
} from "../feedStore";

// THE SCENE. One scroller, one row recipe, and the dividers between runs.
//
// Rebuilt from ../Feed.js, which is 2,408 lines of transcript rendering AND
// composer behaviour AND command handling in one file. This is the transcript
// half only; the composer is phase 4, and keeping them apart is most of why
// the rebuild is worth doing at all.
//
// TranscriptLine is NOT rebuilt and must not be: it lives in
// web/app/components/, and /archive and the GM desk's DM thread render through
// it too (CHAT-REBUILD.md). Its variant contract is what decides how a shout,
// a decree, an emote and an OOC line each look — so every row variant on the
// checklist comes from driving it correctly, not from reimplementing it.
//
// WHAT PHASE 3 DOES NOT HAVE YET: the live stream. The SSE connection, its
// reconnect/backoff and the gap recovery all live in ../Chat.js, tangled with
// that file's layout, and splitting them is its own job (the plan's "split with
// care"). Until then this renders the seeded history and pages backwards
// through it, which is everything except lines arriving while you watch.

// How close to the top starts the next page. Further than a screen, so the
// page is in before the reader reaches the edge of what they have.
const REACH_BACK_PX = 400;
// How far off the bottom still counts as "at the bottom", so a sticky scroll
// survives a rounding error and a rubber band.
const AT_BOTTOM_PX = 64;
// A gap this long starts a new run — the same figure the old feed used.
const RUN_GAP_MS = 7 * 60 * 1000;

// The two kinds that draw as a bordered block across the log rather than as a
// line in it: a heading, the words at reading size, a rule top and bottom.
// The same five minutes db/lib/say.js#EDIT_WINDOW_MS enforces. A NUMBER
// rather than an import: requiring from @lifeweb/db in a "use client" file
// drags Prisma and node:fs into the browser bundle. The server is the one
// that decides; this only decides whether to draw a button.
const EDIT_WINDOW_MS = 5 * 60_000;

const BLOCK_KINDS = new Set(["intercom", "decree"]);
const INTERCOM_PREFIX = /^you hear a voice from the intercom:\s*/i;

function timeLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const ROW_VERBS = [
  { key: "edit", label: "Change", icon: EditIcon, show: (g) => g.mine, run: (h, r) => h.onEdit(r.seq, r.sentAt) },
  { key: "delete", label: "Delete", icon: TrashIcon, show: (g) => g.mine, run: (h, r) => h.onDelete(r.seq, r.sentAt) },
  { key: "look", label: "Look at", icon: EyeIcon, show: (g) => g.canLook, run: (h, r) => h.onLookAt(r.seq) },
  { key: "photo", label: "Photograph", icon: CameraIcon, show: (g) => g.canPhoto, run: (h, r) => h.onPhotograph(r.seq) },
  { key: "star", label: "Save to Notes", icon: NotesIcon, show: (g) => g.canStar, run: (h, r) => h.onStar(r.seq) },
  { key: "remove", label: "Remove", icon: TrashIcon, show: (g) => g.canRemove, run: (h, r) => h.onRemove(r.seq) },
];

// WHAT THE WORLD SAYS, rather than what a person said. Everything with no
// speaker: a gate grinding open, a smell, somebody moving goods around a
// stash — and the two that draw as a whole block, the intercom and a decree.
//
// It is a separate component because it drives TranscriptLine's OTHER
// variants, and those variants are the entire reason a shout does not look
// like an emote. Rendering every row through the speech variant is the bug
// this exists to prevent: ambient scenery came out at full weight, reading as
// an interruption rather than as the room.
const SystemRow = memo(function SystemRow({ row, zone = null }) {
  if (BLOCK_KINDS.has(row.channelKind)) {
    const decree = row.channelKind === "decree";
    // A decree carries its own title, written by a GM: the row is the title, a
    // blank line, then the words. The title is the blackletter heading; the
    // byline says what kind of thing this is and where it was read. A PA has
    // no title of its own, so its heading says both in one line.
    const parts = decree ? splitDecree(row.content) : null;
    const body = decree ? parts.body : String(row.content ?? "").replace(INTERCOM_PREFIX, "");
    return (
      <TranscriptLine
        variant="block"
        channelKind={row.channelKind}
        headingFace={decree ? "blackletter" : "caps"}
        heading={decree ? (parts.title || zone || "Ravenheart") : zone ? `Intercom · ${zone}` : "Intercom"}
        byline={decree ? (zone ? `${DECREE_LABEL} · ${zone}` : DECREE_LABEL) : null}
        seq={row.seq}
      >
        <ChatMarkdown content={body} />
      </TranscriptLine>
    );
  }
  return (
    <TranscriptLine variant="system" channelKind={row.channelKind} seq={row.seq}>
      <ChatMarkdown content={row.content} />
    </TranscriptLine>
  );
});

// memo'd, and the whole reason the store is keyed by seq: a line arriving
// re-renders one of these, not the run of a hundred above it.
const Row = memo(function Row({ line, handlers, editing = false }) {
  const { row, realName, startsRun, mine, live, guards } = line;
  const [draft, setDraft] = useState(row.content ?? "");

  // WHETHER the bar exists is decided here; whether it is SEEN is decided in
  // CSS, by :hover and :focus-within. It was a useState off mouseenter once,
  // which re-rendered the row on every mouse crossing and — worse — meant a
  // keyboard could never reveal it, because a keyboard fires no mouseenter.
  const anyAction = Object.values(guards).some(Boolean);
  const showActions = anyAction && !editing && !row.pending;
  const verbs = ROW_VERBS.filter((v) => v.show(guards));

  return (
    <TranscriptLine
      // Focusable by a tap, never by Tab: a touch screen has no hover, so the
      // bar shows for the row that was tapped (:focus-within). -1 keeps the row
      // out of the Tab order; the bar's own buttons are still reached by
      // keyboard, and focusing one reveals the bar the same way.
      tabIndex={showActions ? -1 : undefined}
      seq={row.seq}
      startsRun={startsRun}
      pending={row.pending}
      // A send that came back refused. The line STAYS — losing what you typed
      // is worse than watching it sit there marked unsent.
      failed={row.failed}
      live={live}
      // The log names EVERY line, not just the first of a run: a scene is read
      // a name at a time, never a face. The real name behind an alias is
      // printed in the parentheses and nowhere else.
      name={realName ? `${row.name} (${realName})` : row.name}
      alias={Boolean(row.alias)}
      // Decided on the server and withheld on a hooded row
      // (db/lib/archive.js#feedRowShape), so a line with no colour is one whose
      // speaker belongs to no estate, or one nobody can see the face of.
      roleGroup={row.roleGroup ?? null}
      time={timeLabel(row.sentAt)}
      edited={Boolean(row.editedAt)}
      actions={
        showActions
          ? verbs.map((v) => (
              <IconButton
                key={v.key}
                icon={v.icon}
                label={v.label}
                onClick={() => v.run(handlers, { seq: row.seq, sentAt: row.sentAt })}
              />
            ))
          : null
      }
      trailing={
        <>
          {/* The same verbs as a ⋯ that opens a sheet — a touch screen has no
              hover, so this is the one action a tap can reach. CSS decides
              which of the two shows. The WRAPPER carries the position, not the
              button: IconButton wraps its button in the tooltip's own span, and
              an absolutely positioned button inside that span pins to the span
              rather than the row. */}
          {showActions && (
            <span className="tline-more">
              <IconButton
                icon={MoreIcon}
                label="Actions"
                size="lg"
                onClick={() => handlers.onOpenMenu({ seq: row.seq, sentAt: row.sentAt, ...guards })}
              />
            </span>
          )}
          {row.failed && (
            <p className="chat-unsent">
              <span>Not sent.</span>
              <button type="button" className="btn-quiet" onClick={() => handlers.onRetry(row.clientId)}>
                Try again
              </button>
            </p>
          )}
        </>
      }
    >
      {editing ? (
        /* The five-minute window, in place. Enter saves and Escape gives up,
           because that is what the box it replaced does — and the row swaps
           back in from the stream rather than from here, so the server stays
           the one that decides what the line now says. */
        <div className="field">
          <textarea
            rows={2}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                handlers.onCancelEdit();
                return;
              }
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              handlers.onSaveEdit(row.seq, draft);
            }}
          />
          <div className="chat-buttons">
            <button type="button" className="btn-quiet" onClick={() => handlers.onSaveEdit(row.seq, draft)}>
              Save
            </button>
            <button type="button" className="btn-quiet" onClick={handlers.onCancelEdit}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <ChatMarkdown content={row.content} />
      )}
    </TranscriptLine>
  );
});

// A print, shown to the photographer — the same courtesy the 📸 reaction pays
// with an embed. The readout is db/lib/examine.js's, built with the viewer's
// own sight stripped out: a lens has no medical training, so a surgeon's
// photograph carries no diagnosis into whoever they hand it to.
function PhotoReadout({ state, onClose }) {
  const readout = state?.readout ?? null;
  return (
    <Modal open title={readout?.name ?? "Photograph"} onClose={onClose} width="default">
      <div className="flex flex-col gap-2">
        {state?.loading && <p className="text-sm text-muted">Winding the film…</p>}
        {state?.error && <FormError>{state.error}</FormError>}
        {state?.line && <p className="text-sm">{state.line}</p>}
        {readout && <Readout readout={readout} />}
        {/* The one thing that is the PRINT's rather than the subject's: what
            the thing in your hands is called, the way it will read in an
            inventory, a stash and a Transfer dialog. */}
        {state?.photoName && <p className="text-xs text-muted">{state.photoName}</p>}
      </div>
    </Modal>
  );
}

// Three faded rows while a place's first page is on the wire — the shape of a
// scene rather than a spinner, so the column does not jump when it lands.
export function FeedSkeleton() {
  return (
    <ul className="chat-feed chat-skeleton" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="chat-skeleton-line">
          <span className="chat-skeleton-bar" />
        </li>
      ))}
    </ul>
  );
}

export default function Feed({
  place,
  self,
  gm = false,
  ghost = false,
  hasCamera = false,
  // speakerKey -> real name, GM seat only (web/lib/gmSpeakers.js). It is what
  // lets a hooded line read as "A young man (Greeblus)".
  speakers = null,
  // The seq this place was at when it was last read, so the NEW rule lands in
  // the right gap. Null means everything here has been read.
  newAt = null,
  // Bumped on every `places` frame — a key turning, or somebody else's /add.
  // The members strip re-reads on it.
  placesVersion = 0,
  // A street being watched from somewhere else: read, never written to
  // (db/lib/vantages.js). The guest-list buttons are a thing you do with your
  // hands in the room.
  readOnly = false,
  // The head's search box: the shell owns whether it is open, because the
  // button that opens it lives on the bar the shell draws. A jump that lands
  // on nothing forces it open from here regardless — the box has to come back
  // and say so rather than shutting on nothing.
  searchOpen = false,
  onCloseSearch = null,
  // A line found by search: which one, and when it was picked, so picking the
  // same hit twice scrolls twice. The window around it is already in the
  // store by the time this arrives.
  jump = null,
  onJump = null,
  // The noticeboard nailed to the top of a street. Null everywhere else.
  notices = null,
  // The composer's own, because a retry re-SENDS and the send queue is its.
  // Null leaves a refused line sitting there marked unsent, which is still
  // better than losing the words.
  onRetry = null,
}) {
  const placeKey = place?.placeKey ?? null;
  const rows = useFeed(placeKey);
  const members = usePlaceMembers(place, placesVersion);
  const confirm = useConfirm();
  // The `at` of a jump whose failure the reader has already waved away, so
  // the notice does not come back every time the scene re-renders.
  const [dismissedJump, setDismissedJump] = useState(null);

  // ---- What a row can have done to it ------------------------------------
  //
  // Owned HERE, not handed down from the shell: every one of these is a verb
  // against a LINE, and the feed is what holds the lines. The old chat kept
  // them in the same file as the composer, which is why the composer's answer
  // line ended up being where a starred line said so.
  //
  // Every guard below is re-decided by the SERVER when it is pressed — the
  // five-minute window, the camera in your hands, whether that person is
  // still standing beside you. What is drawn is a hint.
  const [rowError, setRowError] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [editingSeq, setEditingSeq] = useState(null);
  const [look, setLook] = useState(null);
  const [photo, setPhoto] = useState(null);
  // The row a tap opened the ⋯ sheet for. A touch screen has no hover, so
  // this is the one way in on a phone.
  const [menuRow, setMenuRow] = useState(null);

  // The window, read in an EVENT handler, where reading the clock is both
  // legal and correct. The refusal is the bot's word for word, so a player
  // hears one rule on both faces.
  const withinWindow = (sentAt) => Date.now() - new Date(sentAt ?? 0).getTime() < EDIT_WINDOW_MS;
  const TOO_LATE = "You can't edit that any more.";

  const onEdit = useCallback((seq, sentAt) => {
    if (!withinWindow(sentAt)) {
      setRowError(TOO_LATE);
      return;
    }
    setRowError(null);
    setEditingSeq(seq);
  }, []);
  const onCancelEdit = useCallback(() => setEditingSeq(null), []);

  // Nothing is written into the store here: the edited row comes back down
  // the stream, so the server stays the one that says what the line says.
  const onSaveEdit = useCallback(async (seq, content) => {
    setEditingSeq(null);
    try {
      const res = await fetch("/api/feed/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seq, content }),
      });
      const data = await res.json().catch(() => null);
      setRowError(res.ok ? null : (data?.error ?? "That didn't change."));
    } catch {
      setRowError("That didn't change.");
    }
  }, []);

  // Taking a line back, and a GM taking one down: the same route, and the
  // route is what decides which of the two this is —
  // db/lib/say.js#deleteSpeech skips the owner and the window for a GM.
  const removeLine = useCallback(
    async (seq, { title, message, confirmLabel }) => {
      if (!(await confirm({ title, message, confirmLabel }))) return;
      try {
        const res = await fetch("/api/feed/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seq }),
        });
        const data = await res.json().catch(() => null);
        setRowError(res.ok ? null : (data?.error ?? "That didn't go."));
      } catch {
        setRowError("That didn't go.");
      }
    },
    [confirm],
  );

  const onDelete = useCallback(
    (seq, sentAt) => {
      if (!withinWindow(sentAt)) {
        setRowError(TOO_LATE);
        return;
      }
      return removeLine(seq, {
        title: "Delete this line?",
        message: "It goes from here and from Discord.",
        confirmLabel: "Delete",
      });
    },
    [removeLine],
  );

  const onRemove = useCallback(
    (seq) =>
      removeLine(seq, {
        title: "Remove this line?",
        message: "It goes from here and from Discord.",
        confirmLabel: "Remove it",
      }),
    [removeLine],
  );

  // Look at, pressed against the ROW rather than the person. The browser
  // sends a seq and nothing else; the server resolves who said it, whether
  // they were hooded AT THE TIME, and whether this reader may see the place
  // (db/lib/examineRow.js). That is what lets the eye sit on a hooded line at
  // all, and what makes it answer for the hood worn when the words were said
  // rather than the one being worn now.
  const onLookAt = useCallback((seq) => {
    if (!seq) return;
    setLook({ loading: true });
    lookAtRow(seq)
      .then((res) => (res?.ok ? setLook({ readout: res.readout }) : setLook({ error: res?.error ?? "You can't see them." })))
      .catch(() => setLook({ error: "You can't see them." }));
  }, []);

  // The camera is not spent (db/lib/photoMint.js) and the print is deduped
  // per (photographer, row) server-side, so a second press on the same line
  // gives back the refusal the bot's 📸 does rather than a second Tag row.
  const onPhotograph = useCallback((seq) => {
    setPhoto({ loading: true });
    photographRow(seq)
      .then((res) =>
        res?.ok
          ? setPhoto({ readout: res.readout, photoName: res.photoName, line: res.line })
          : setPhoto({ error: res?.error ?? "The camera caught nothing." }),
      )
      .catch(() => setPhoto({ error: "The camera caught nothing." }));
  }, []);

  // ⭐ — the web twin of the reaction in Discord, writing the same `Note` row.
  // The server upsert makes a second press a no-op rather than a second note,
  // so this needs no pressed state of its own. The answer lands UNDER THE
  // SCENE rather than on the composer's line, which is where it used to go:
  // what you starred is a line you are looking at, not the box you have not
  // typed in.
  const onStar = useCallback((seq) => {
    setRowError(null);
    starRow(seq)
      .then((res) => (res?.ok ? setAnswer(res.line ?? "Saved to your Notes.") : setRowError(res?.error ?? "That line is gone.")))
      .catch(() => setRowError("Could not reach the server. Nothing was changed."));
  }, []);

  const rowHandlers = useMemo(
    () => ({
      onEdit,
      onCancelEdit,
      onSaveEdit,
      onDelete,
      onLookAt,
      onPhotograph,
      onStar,
      onRemove,
      onOpenMenu: setMenuRow,
      onRetry,
    }),
    [onEdit, onCancelEdit, onSaveEdit, onDelete, onLookAt, onPhotograph, onStar, onRemove, onRetry],
  );
  const historyState = useHistoryState(placeKey);
  const backlog = useBacklog(placeKey);

  const scrollerRef = useRef(null);
  const anchorRef = useRef(null);
  const [pinned, setPinned] = useState(true);
  // How many rows the scene had when the reader last left the bottom. Null
  // while they are still down there. The "N new" count is DERIVED from it
  // rather than counted up in the effect below — incrementing state from an
  // effect is `react-hooks/set-state-in-effect`, an error here, and it is the
  // wrong shape anyway: a count of what arrived is a subtraction, not a tally.
  const [markAt, setMarkAt] = useState(null);

  // Rows that arrived AFTER this place was painted are the only ones that
  // fade in. Without it every backlog page animates as it lands, which reads
  // as the scene rewriting itself.
  // The newest line this place already had when it was painted. Everything
  // after it fades in; everything before it is backlog and must not, or every
  // page that lands animates and the scene reads as rewriting itself.
  //
  // useState with an initialiser, not a ref: it is computed once at mount and
  // never changes, which is what state-with-no-setter means. A ref would be
  // the wrong tool AND an illegal one — reading `.current` inside the useMemo
  // below is a read during render, which `react-hooks/refs` refuses.
  const [paintedAt] = useState(() => rows[rows.length - 1]?.seq ?? null);

  const lines = useMemo(
    () =>
      rows.map((row, i) => {
        const prev = i > 0 ? rows[i - 1] : null;
        const mine = isOwnRow(row, self?.characterId ?? null, self?.speakerKey ?? null);
        const system = !row.name;
        // A run is one speaker talking without a long gap. Seven minutes, and
        // a change of speaker always starts a new one.
        const gap = prev && row.sentAt && prev.sentAt
          ? new Date(row.sentAt) - new Date(prev.sentAt)
          : Infinity;
        const startsRun = !prev || prev.speakerKey !== row.speakerKey || gap > RUN_GAP_MS;
        return {
          row,
          startsRun,
          mine,
          system,
          live: Boolean(row.seq && paintedAt && BigInt(row.seq) > BigInt(paintedAt)),
          // A GM reads the name behind an alias; a player never does, which is
          // the whole point of wearing one.
          realName: gm && row.alias && row.speakerKey ? (speakers?.[row.speakerKey] ?? null) : null,
          guards: {
            mine: mine && !system,
            // Looking needs a living character, and a watcher of either kind
            // has none. `canLook` is also why a hooded row offers nothing:
            // it carries an alias rather than a name.
            canLook: !mine && !system && !gm && !ghost && !row.alias,
            canPhoto: !mine && !system && !gm && !ghost && hasCamera,
            // A GM with no living character may take any line down — no
            // ownership, no five-minute window.
            canRemove: gm && Boolean(row.seq) && !system,
            // A note is filed under a living character.
            canStar: row.seq != null && !gm && !ghost,
          },
          // A rule wherever the scene crosses into a new turn. Never on the
          // first row of a place: there is no "before" to have crossed from.
          dayBreak: Boolean(prev) && row.turnNumber != null && row.turnNumber !== prev?.turnNumber,
          newLine: Boolean(row.seq) && String(row.seq) === String(newAt),
        };
      }),
    [rows, self?.characterId, self?.speakerKey, gm, ghost, hasCamera, speakers, newAt, paintedAt],
  );

  // One page further back, when the reader gets near the top.
  //
  // It lives here rather than with the other history fetches because the
  // scroll position is BOTH the trigger and the thing that has to be put back:
  // the anchor is measured in the beat between the rows arriving and React
  // laying them out, which is this component's own render.
  const reachBack = useCallback(() => {
    if (!placeKey) return;
    const state = backlogOf(placeKey);
    if (state.loading || state.exhausted) return;
    // Nothing on screen yet means the first page is still out, and it will
    // bring the cursor this pages from.
    const cursor = oldestSeq(placeKey);
    if (!cursor) return;
    setBacklog(placeKey, { loading: true });
    fetch(`/api/feed/history?place=${encodeURIComponent(placeKey)}&before=${encodeURIComponent(cursor)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) {
          setBacklog(placeKey, { loading: false });
          return;
        }
        const older = Array.isArray(data.rows) ? data.rows : [];
        // Measured only when there is something to put on top, and measured
        // HERE, before seedRows re-renders — the DOM is still the old, shorter
        // one at this point. An anchor set for a page that turned out empty
        // would sit unclaimed until the next line somebody spoke, then yank
        // the reader for no reason.
        if (older.length > 0) {
          const el = scrollerRef.current;
          if (el) anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
          seedRows(placeKey, older);
        }
        setBacklog(placeKey, { loading: false, exhausted: older.length === 0 });
      })
      .catch(() => setBacklog(placeKey, { loading: false }));
  }, [placeKey]);

  const rowCount = lines.length;

  // A scroll EVENT handler, so setting state here is legal and ordinary —
  // which is the other half of why the count is derived.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
    setPinned(atBottom);
    // Mark on the way OUT only. Re-marking on every scroll event while away
    // from the bottom would reset the count to zero each time the reader
    // nudged the wheel.
    setMarkAt((prev) => (atBottom ? null : (prev ?? rowCount)));
    if (el.scrollTop < REACH_BACK_PX) reachBack();
    // `rowCount` is a dependency rather than a ref read during render, which
    // this repo refuses. It costs a new function per arriving line, and that
    // is free: onScroll is a React prop, delegated from the root, not an
    // addEventListener that would detach and reattach.
  }, [reachBack, rowCount]);

  // Two jobs, one layout effect, because both have to happen before paint or
  // the reader sees the wrong frame.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // Putting the reader back where they were after a backlog page lands: the
    // scroller grew upward by exactly the difference in height.
    const anchor = anchorRef.current;
    if (anchor) {
      anchorRef.current = null;
      el.scrollTop = el.scrollHeight - anchor.height + anchor.top;
      return;
    }
    // Sticky bottom, for a reader who was already there. Nothing else: the
    // count of what they missed is derived below, so this effect only ever
    // moves the scroller and never sets state.
    if (pinned) el.scrollTop = el.scrollHeight;
    // `pinned` is deliberately NOT a dependency: this runs when the ROWS
    // change and reads whether the reader was at the bottom at that moment.
    // Listing it would re-run the whole thing on every scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length]);

  // A search hit. The row is already in the store when this runs — the shell
  // loads the window around the seq before handing the jump down — so this is
  // the scroll and the flash and nothing else. DOM calls, no state: the
  // highlight is an attribute the CSS animates and then nobody looks at again.
  useEffect(() => {
    // Only once the place it names is the place on screen. Setting the open
    // place and setting this happen together, but the swap arrives a beat
    // later.
    if (!jump?.seq || jump.placeKey !== placeKey) return undefined;
    const el = scrollerRef.current;
    if (!el) return undefined;
    const row = el.querySelector(`[data-seq="${CSS.escape(String(jump.seq))}"]`);
    if (!row) return undefined;
    // The reader is being taken somewhere on purpose, so the follow-the-bottom
    // rule stands down until they scroll again.
    setPinned(false);
    row.scrollIntoView({ block: "center" });
    row.setAttribute("data-hit", "true");
    const timer = setTimeout(() => row.removeAttribute("data-hit"), 2000);
    return () => clearTimeout(timer);
  }, [jump, placeKey]);

  // What arrived since they left the bottom. A subtraction, not a tally.
  const behind = markAt == null ? 0 : Math.max(0, rowCount - markAt);

  const toBottom = () => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setPinned(true);
    setMarkAt(null);
  };

  if (!place) {
    return (
      <div className="chat-feed">
        <EmptyState>Nowhere is open.</EmptyState>
      </div>
    );
  }

  if (historyState === "loading" && rows.length === 0) return <FeedSkeleton />;

  // The hit the reader asked for is not in this place's rows, so it is gone —
  // deleted, or wiped at Dawn. The box comes back open to say so, once.
  const jumpMissed =
    Boolean(jump?.seq) &&
    jump.placeKey === placeKey &&
    jump.at !== dismissedJump &&
    !rows.some((row) => String(row.seq) === String(jump.seq));
  const showSearch = Boolean(onJump) && (searchOpen || jumpMissed);
  const closeSearch = () => {
    setDismissedJump(jump?.at ?? null);
    onCloseSearch?.();
  };

  return (
    <div className="chat-feed-wrap">
      {showSearch && (
        <FeedSearch
          place={place}
          notice={jumpMissed ? "Couldn't find that line." : null}
          onClose={closeSearch}
          onPick={(hitPlace, seq) => {
            // NOT dismissed: if this hit turns out to be gone too, the box has
            // to come back and say so rather than shutting on nothing.
            onCloseSearch?.();
            onJump(hitPlace, seq);
          }}
        />
      )}
      {/* Who is in this conversation or private room, and the two buttons
          that change it. Only those two kinds of place have one, and the
          strip draws nothing when placeMembers() answers with no list. On a
          phone it folds to one row of faces until tapped (MembersStrip.js). */}
      {members.hasMembers && !readOnly && (
        <MembersStrip placeKey={placeKey} data={members.data} onChanged={members.reload} />
      )}
      <ul className="chat-feed" ref={scrollerRef} onScroll={onScroll}>
        {/* The top edge, while a page is on the wire. Nothing when there is
            nothing more to fetch — a permanent "no more" line at the head of
            every scene says something nobody asked. */}
        {/* The board is NAILED TO THE TOP of the street, not filed into it:
            a notice is a thing on a wall, and a wall does not scroll past. */}
        {notices && <li className="chat-notices">{notices}</li>}

        {backlog.loading && <li className="chat-backlog-edge">Reading further back…</li>}

        {lines.map((line) => (
          <Fragment key={line.row.seq ?? line.row.clientId}>
            {line.dayBreak && <li className="daybreak">{formatTurnLabel(line.row.turnNumber)}</li>}
            {line.newLine && <li className="chat-new-line" aria-hidden="true" />}
            {line.system ? (
              <SystemRow row={line.row} zone={place?.zoneName ?? null} />
            ) : (
              <Row line={line} handlers={rowHandlers} editing={Boolean(line.row.seq) && line.row.seq === editingSeq} />
            )}
          </Fragment>
        ))}

        {rows.length === 0 && historyState !== "loading" && (
          <li>
            <EmptyState>Nothing has been said here yet.</EmptyState>
          </li>
        )}
      </ul>

      {/* Somebody spoke while the reader was reading further up. A pill rather
          than a jump: moving the scene under somebody mid-sentence is the one
          thing a live feed must not do. */}
      {behind > 0 && (
        <button type="button" className="chat-pill" onClick={toBottom}>
          {behind} new
        </button>
      )}

      {/* What a row action said back, under the scene rather than under the
          box: the line you acted on is the thing you are looking at. */}
      {answer && <p className="chat-quiet-line">{answer}</p>}
      <FormError>{rowError}</FormError>

      {/* The sheet a TAP opens instead of the hover bar. Same verbs, same
          guards, same handlers — each closes the sheet first, then does what
          the bar's button would have done. No title: the verbs are the whole
          sheet, and a tap outside or Escape closes it. */}
      {menuRow && (
        <Modal open onClose={() => setMenuRow(null)}>
          <div className="chat-sheet-menu" role="menu">
            {ROW_VERBS.filter((v) => v.show(menuRow)).map((v) => (
              <button
                key={v.key}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setMenuRow(null);
                  v.run(rowHandlers, menuRow);
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {photo && <PhotoReadout state={photo} onClose={() => setPhoto(null)} />}
      {look && <LookReadout state={look} onClose={() => setLook(null)} />}
    </div>
  );
}
