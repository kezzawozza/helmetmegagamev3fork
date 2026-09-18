"use client";

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import TranscriptLine from "@/app/components/TranscriptLine";
import EmptyState from "@/app/components/EmptyState";
import FormError from "@/app/components/FormError";
import IconButton from "@/app/components/IconButton";
import Modal from "@/app/components/Modal";
import Select from "@/app/components/Select";
import useComposerAutosize from "./useComposerAutosize";
import { CameraIcon, EditIcon, EyeIcon, MoreIcon, NotesIcon, PlusIcon, QuillIcon, SearchIcon, SendIcon, TrashIcon } from "@/app/components/icons";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import { Readout } from "@/app/components/ExamineDialog";
import LookReadout from "@/app/components/LookReadout";
import useActionRunner from "@/app/components/useActionRunner";
import { photographRow, starRow, lookAt, lookAtRow, loadTravel, placeMembers, gmSpeakerNames, gmSystemPost } from "./actions";
import useVisiblePoll from "./useVisiblePoll";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import useNarrow from "./useNarrow";
import ChatHead from "./ChatHead";
import {
  useFeed,
  useHistoryState,
  useBacklog,
  backlogOf,
  setBacklog,
  seedRows,
  applyRow,
  addPending,
  markPendingFailed,
  retryPending,
  newestSeq,
  oldestSeq,
  isOwnRow,
} from "./feedStore";
import FeedSearch from "./FeedSearch";
import { useTyping, typingLine } from "./typingStore";
import { peekSeen } from "./seenStore";
import { readDraft, writeDraft } from "./draftStore";
// By PATH, never through the @lifeweb/db barrel: the barrel pulls Prisma and
// node:fs into whatever imports it, and this is a "use client" file. That
// module is pure string work with no requires of its own, so it is safe here
// — and it has to be here, or the row this composer draws says something
// different from the row the server writes a moment later.
import { chunkMessage } from "@lifeweb/db/lib/chunkText";
import { MESSAGE_LIMIT, MAX_SAY_PIECES, COUNT_FROM, tooManyPieces } from "@lifeweb/db/lib/sayLimits";
import { capitalizeSentences, fixContractions } from "@lifeweb/db/lib/textCorrection";
import MentionMenu, { mentionQueryAt, matchRoster } from "./MentionMenu";
import CommandMenu from "./CommandMenu";
import MembersStrip from "./MembersStrip";
import {
  commandsFor,
  exactCommand,
  matchCommands,
  pendingArg,
  slashQueryAt,
  textArgOf,
} from "./commands";
import { MOVE_KINDS } from "./MoveDialog";

// One place's scene: what has been said here, and — where the place allows it
// — the box to say something.
//
// This was PlayFeed.js, which knew about exactly one Location. It knows about
// a PLACE now: the Location you are standing in, a Room off it, a conversation
// you are in, or the zone's summary. What changes between them is the name in
// the composer, whether there IS a composer, and the slowmode; everything
// else is the same scene.
//
// Nothing here waits on a server round trip to move. Pressing Enter appends
// the row to the store in the same frame and clears the box; the POST that
// follows only swaps the confirmed row in behind it. That is the whole reason
// this page is not a server action and a revalidatePath — see the plan's
// "Why the past web UIs felt slow".

// A run is one speaker's messages within seven minutes of each other, drawn
// as one block with a single face. The rule is copied from DmThread.js rather
// than imported: that component is a GM's DM conversation, a different shape
// with a different row type, and sharing the constant would tie them together
// for no gain.
const RUN_GAP_MS = 7 * 60_000;
// How often, at most, a GM's seat re-asks for the speaker directory when a row
// turns up under a hood it does not know (web/lib/gmSpeakers.js).
const SPEAKER_REFRESH_MS = 60_000;
// How close to the bottom still counts as "reading the newest", in px.
const STICK_PX = 40;
// How close to the TOP starts the next page of the backlog. Further than
// STICK_PX because this one has a round trip behind it: asking a few hundred
// pixels early means the rows are usually there before the reader arrives,
// rather than a stall at the very top of the list.
const REACH_PX = 400;
// The same five minutes db/lib/say.js#EDIT_WINDOW_MS enforces. Kept here as a
// number rather than imported, because importing from @lifeweb/db in a
// "use client" file drags Prisma and node:fs into the browser bundle. The
// server is the one that decides; this only decides whether to draw a button.
const EDIT_WINDOW_MS = 5 * 60_000;

function timeLabel(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// What the world says, rather than what a person says: an arrival, a smell, a
// turret, the turn line. Drawn as subtext with no face, the same way Discord
// renders the `-#` these lines go out as (db/lib/ambientLine.js).
//
// The intercom is the one SYSTEM row that isn't scenery — it's a loudspeaker
// (db/lib/intercom.js, CLAUDE.md "Bot message style"), tagged with
// `channelKind: "intercom"` in db/lib/scene.js precisely so this can tell it
// apart and draw it full size and bold instead of small and muted.
//
// An OOC line is the third: not the world talking and not a character
// talking, but the PLAYER (db/lib/ooc.js). Subtext like the scenery, because
// it is not happening in the room either — but its own tag, so it can be told
// apart from a smell at a glance.
//
// A shout is three sizes, matching db/lib/shout.js#shoutChannelKind: distance
// 0 (`"shout"`) draws bigger than ordinary chat text, distance 1
// (`"shout-near"`, still fully audible on Discord too) draws at ordinary
// size, and anything past that keeps no tag and falls through to the default
// subtext — matching its muffled `-#` treatment on Discord.
const SystemRow = memo(function SystemRow({ row }) {
  // The five-way branch that used to live here is CSS now: channelKind goes
  // straight onto data-kind and .tline--system keys off it.
  return (
    <TranscriptLine variant="system" channelKind={row.channelKind} seq={row.seq}>
      <ChatMarkdown content={row.content} />
    </TranscriptLine>
  );
});

// Discord's red line: everything under it landed since you last had this
// place open. Drawn once, where the list was when you opened it, and left
// there while you read — it is a bookmark, not a cursor.
// The top of the list, when there is more of the scene than one page of it.
//
// Deliberately not a button. Reading further back happens on the scroll (see
// reachBack), so this only ever REPORTS what is on the wire. A place can run
// out because it is young, or because a turn wipe put the rest below the line
// (db/lib/feedWipe.js) — the floored case says nothing rather than nudge the
// reader toward the archive.
function BacklogEdge({ loading, exhausted, floored }) {
  if (loading) return <li className="chat-backlog-edge">Reading further back…</li>;
  if (!exhausted || floored) return null;
  return <li className="chat-backlog-edge">This is the beginning.</li>;
}

function NewLine() {
  return (
    <li className="chat-new-line" aria-hidden="true">
      <span>NEW</span>
    </li>
  );
}

// What a place looks like while its backlog is on the wire. Three faded rows
// with no words in them, so the shape of the scene is already on the page when
// the rows land and nothing has to say "Nothing has been said here yet."
// first and then take it back. Tokens only, and aria-hidden: there is nothing
// here for a screen reader to read.
export function FeedSkeleton() {
  return (
    <ul className="list-none p-0" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="chat-skeleton">
          <span className="chat-skeleton-face" />
          <span className="chat-skeleton-lines">
            <span className="chat-skeleton-bar" data-w="short" />
            <span className="chat-skeleton-bar" />
          </span>
        </li>
      ))}
    </ul>
  );
}

// The six verbs a row can offer, in the one order both the hover bar and the
// touch sheet draw them in. `show` reads the same guards FeedRow already
// computes (`mine`/`canLook`/`canPhoto`/`canStar`/`canRemove`); `run` calls
// the matching handler off the bag Feed hands down, against `{seq, sentAt}`.
// One table instead of two hand-written lists, so a seventh verb is added
// once and shows up in both places the same day.
const ROW_VERBS = [
  { key: "edit", label: "Change", icon: EditIcon, show: (g) => g.mine, run: (h, r) => h.onEdit(r.seq, r.sentAt) },
  { key: "delete", label: "Delete", icon: TrashIcon, show: (g) => g.mine, run: (h, r) => h.onDelete(r.seq, r.sentAt) },
  { key: "look", label: "Look at", icon: EyeIcon, show: (g) => g.canLook, run: (h, r) => h.onLookAt(r.seq) },
  { key: "photo", label: "Photograph", icon: CameraIcon, show: (g) => g.canPhoto, run: (h, r) => h.onPhotograph(r.seq) },
  { key: "star", label: "Save to Notes", icon: NotesIcon, show: (g) => g.canStar, run: (h, r) => h.onStar(r.seq) },
  { key: "remove", label: "Remove", icon: TrashIcon, show: (g) => g.canRemove, run: (h, r) => h.onRemove(r.seq) },
];

// memo'd, and the whole point of keying the store by seq: a new message
// re-renders one of these, not the run of a hundred above it.
const FeedRow = memo(function FeedRow({
  row,
  // The name behind the alias, for a GM reading a scene, and null for every
  // other reader. It is printed beside the alias and nowhere else — no
  // tooltip, no second element, nothing to hover for.
  realName = null,
  startsRun,
  mine,
  // Somebody else's line, and this reader may look at who said it: the row
  // carries a name rather than an alias (see the note on `canLook` below).
  canLook,
  // …and has an instant camera in their hands.
  canPhoto,
  // A GM with no living character. They may take any line down, their own
  // rules — no ownership, no five-minute window.
  canRemove,
  // ⭐ needs a living character to file the note under (chat/actions.js#starRow).
  canStar,
  editing,
  // True only for a row that arrived after this place was painted, so the
  // backlog does not animate. See `liveAfter`.
  live,
  onRetry,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onLookAt,
  onPhotograph,
  onStar,
  onRemove,
  onOpenMenu,
}) {
  const [draft, setDraft] = useState(row.content ?? "");

  // ⭐ is offered on every line that HAS a seq — your own included, exactly as
  // the reaction is in Discord — which is what widened the bar past the rows
  // somebody can act against. A system line with no seq still has nothing.
  const anyAction = mine || canLook || canPhoto || canRemove || canStar;
  // WHETHER the bar exists is decided here; whether it is SEEN is decided in
  // CSS, by .tline:hover and :focus-within. It used to be a useState set
  // from onMouseEnter/onMouseLeave, which re-rendered the row on every mouse
  // crossing and — worse — meant a keyboard could never reveal the bar at
  // all, because a keyboard produces no mouseenter. Rendering it always and
  // letting :focus-within do the work is what makes it reachable by tab.
  const showActions = anyAction && !editing && !row.pending;
  const guards = { mine, canLook, canPhoto, canStar, canRemove };
  const handlers = { onEdit, onDelete, onLookAt, onPhotograph, onStar, onRemove };
  const verbs = ROW_VERBS.filter((v) => v.show(guards));

  return (
    <TranscriptLine
      // Focusable by a tap, never by Tab: on a touch screen there is no
      // hover, so the action bar shows for the row that was tapped
      // (:focus-within, globals.css) — Discord's long-press, one gesture
      // cheaper. -1 keeps the row out of the Tab order; the bar's own
      // buttons are still reached by keyboard, and focusing one of them
      // reveals the bar the same way.
      tabIndex={showActions ? -1 : undefined}
      seq={row.seq}
      startsRun={startsRun}
      pending={row.pending}
      // Only a line that ARRIVED gets the fade. See `liveAfter` below.
      live={live}
      // The face draws only on the first line of a run; the gutter keeps its
      // width on every line so the text stays aligned.
      avatar={
        startsRun ? (
          <CharacterAvatar
            characterId={row.characterId}
            name={row.name ?? ""}
            version={row.avatarVersion}
            src={row.avatarPath ?? undefined}
            // A line said under an alias before the game recorded what was
            // over the speaker's face. It cannot be given one now — the sprite
            // lived on the tag they were wearing then — so it keeps its secret
            // and draws the plate (db/lib/archive.js#feedRowShape).
            unknown={row.unknownFace}
            size={32}
            zoomable
          />
        ) : null
      }
      // A run's second line prints no head at all, which is what `name`
      // being null means. The real name behind an alias is printed in the
      // parentheses and nowhere else — no tooltip, no second element.
      name={startsRun ? (realName ? `${row.name} (${realName})` : row.name) : null}
      alias={Boolean(row.alias)}
      time={timeLabel(row.sentAt)}
      edited={Boolean(row.editedAt)}
      // The bar FLOATS over the row's top-right corner (.tline-actions), so it
      // never pushes the sentence around when a mouse crosses the line.
      // Everything it offers is re-decided by the server when it is pressed:
      // the five-minute window, the camera in your hands, whether that person
      // is still standing beside you.
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
          {/* Same verbs as the hover bar above, as a ⋯ that opens a bottom
              sheet — a touch screen has no hover, so this is the one action a
              tap can reach. CSS decides which of the two shows (globals.css).
              The wrapper carries the position, not the button: IconButton
              wraps its button in the tooltip's own span, and an absolutely
              positioned button inside that span pins to the span, not the
              row — which put the ⋯ over the avatar. */}
          {showActions && (
            <span className="tline-more">
              <IconButton
                icon={MoreIcon}
                label="Actions"
                size="lg"
                onClick={() =>
                  onOpenMenu({
                    seq: row.seq,
                    sentAt: row.sentAt,
                    mine,
                    canLook,
                    canPhoto,
                    canStar,
                    canRemove,
                  })
                }
              />
            </span>
          )}
          {row.failed && (
            <button type="button" className="btn-quiet" onClick={() => onRetry(row.clientId)}>
              Try again
            </button>
          )}
        </>
      }
    >
      {editing ? (
        <div className="field">
          <textarea
            rows={2}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onCancelEdit();
                return;
              }
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              onSaveEdit(row.seq, draft);
            }}
          />
          <div className="chat-buttons">
            <button type="button" className="btn-quiet" onClick={() => onSaveEdit(row.seq, draft)}>
              Save
            </button>
            <button type="button" className="btn-quiet" onClick={onCancelEdit}>
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

// What the camera caught. The print is already in your pocket by the time
// this opens — a Tag row of its own (db/lib/photoMint.js) — so this is the
// photographer being shown their own shot, the same courtesy the 📸 reaction
// pays with an embed. The footer is the photo's NAME, which is how it will
// read in an inventory, a stash and a Transfer dialog.
//
// The readout is db/lib/examine.js#examineReadout, built with the viewer's
// own sight stripped out: a lens has no medical training, so a surgeon's
// photograph carries no diagnosis into the hands of whoever they give it to.
function PhotoReadout({ state, onClose }) {
  const readout = state?.readout ?? null;

  return (
    <Modal open title={readout?.name ?? "Photograph"} onClose={onClose} width="default">
      <div className="flex flex-col gap-2">
        {state?.loading && <p className="text-sm text-muted">Winding the film…</p>}
        {state?.error && <FormError>{state.error}</FormError>}
        {state?.line && <p className="text-sm">{state.line}</p>}
        {/* The SAME block the sheet's Look at draws
            (web/app/components/ExamineDialog.js). A photograph is a readout
            of a moment, so there was never a reason for it to be a poorer
            one — db/lib/examine.js already decides what a print gives away,
            and photographRow() strips the looker's own sight before it asks. */}
        {readout && <Readout readout={readout} />}
        {/* The only thing that is the PHOTOGRAPH's rather than the subject's:
            what the print in your hands is called. */}
        {state?.photoName && (
          <p className="text-xs text-muted">{state.photoName}</p>
        )}
      </div>
    </Modal>
  );
}

function newClientId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// How often this tab tells the server somebody is writing. The route holds the
// real limit (a client is the half a player can rewrite); this only keeps a
// held-down key from being a request per character.
const TYPING_PING_MS = 4000;

// How many times a slowmode refusal resends on its own before the row is
// given up on. Three covers a clock that was a second out; more would be a
// tab talking to itself.
const MAX_SLOWMODE_RETRIES = 3;

// How often the members strip re-reads itself with nothing prompting it. See
// the interval in Feed() for why a push-only strip is not enough.
const MEMBERS_REFRESH_MS = 60_000;

// What `/travel`'s picker says when the reachable places could not be read.
const ROAD_ERROR = "Couldn't read the road. Try again.";

// The chips a command still wants: a person, a Move kind, or a destination.
//
// One row at a time — the FIRST unfilled argument is the question being
// asked. Drawing every argument at once would make this a form, and the whole
// point of a command line is that it asks one thing and then gets out of the
// way.
//
// The person row includes HOODS where the command says it may (`/look`), and
// their value is the opaque token db/lib/whosHere.js minted, not an id: the
// browser is never told who is under one.
// At most this many faces in the person row. Past a dozen the chips wrap into
// a wall and the box they belong to is off the bottom of the screen; the
// filter below is what a player uses to get past it.
const PERSON_CHIP_LIMIT = 12;

function CommandArgs({ command, people, members, query = "", onPick }) {
  const { entry, values } = command;
  const arg = pendingArg(entry, values);
  const [destinations, setDestinations] = useState(null);

  // The reachable places, only for a command that asks for one. Fetched on
  // demand rather than with the page: an exit's state moves under a player
  // standing still, and a stale list would offer a shut gate.
  useEffect(() => {
    if (arg?.kind !== "destination") return undefined;
    let cancelled = false;
    // A refusal or a dropped request is kept apart from an empty list: "no
    // way out" is a fact about the place, and it must not be what a network
    // blip reads as.
    loadTravel()
      .then((res) => {
        if (!cancelled) setDestinations(res?.ok ? res.options : { error: res?.error ?? ROAD_ERROR });
      })
      .catch(() => {
        if (!cancelled) setDestinations({ error: ROAD_ERROR });
      });
    return () => {
      cancelled = true;
    };
  }, [arg?.kind]);

  if (!arg) return null;

  if (arg.kind === "moveKind") {
    return (
      <div className="chip-row" role="radiogroup" aria-label="What kind of Move">
        {MOVE_KINDS.map((kind) => (
          <button
            key={kind.value}
            type="button"
            role="radio"
            aria-checked={values[arg.name] === kind.value}
            className="chip"
            data-active={values[arg.name] === kind.value ? "true" : undefined}
            // The textarea must not lose focus to a chip: the next thing the
            // player types is the command's text argument.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(arg.name, kind.value)}
          >
            {kind.label}
          </button>
        ))}
      </div>
    );
  }

  if (arg.kind === "destination") {
    if (!destinations) return <p className="text-sm text-muted">Reading the road…</p>;
    if (destinations.error) return <p className="text-sm text-muted">{destinations.error}</p>;
    if (destinations.length === 0) return <p className="text-sm text-muted">No way out of here.</p>;
    return (
      <div className="chip-row" aria-label="Where to">
        {destinations.map((option) => (
          <button
            key={option.id}
            type="button"
            className="chip"
            title={option.reason ?? undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(arg.name, option.id)}
          >
            {option.name}
          </button>
        ))}
      </div>
    );
  }

  // `from: "members"` is /remove, whose people are the guest list rather than
  // the street — a conversation member need not be standing beside you. It
  // falls back to who is here when the list has not landed.
  const roster =
    arg.from === "members" && members.length > 0
      ? members
      : [...(people?.named ?? []), ...(arg.hoods ? (people?.concealed ?? []) : [])];

  if (roster.length === 0) return <p className="text-sm text-muted">Nobody to pick.</p>;

  // What is in the box FILTERS the row. A command that asks for a person has
  // no text argument, so the textarea is doing nothing else — and a Location
  // with thirty people in it is otherwise a picker you scroll rather than one
  // you use. Same prefix rule as the @ list, so the two behave alike.
  const hits = matchRoster(roster, query, Infinity);
  const shown = hits.slice(0, PERSON_CHIP_LIMIT);
  const more = hits.length - shown.length;

  if (shown.length === 0) return <p className="text-sm text-muted">Nobody here by that name.</p>;

  return (
    <div className="chip-row" aria-label="Who">
      {shown.map((person, index) => {
        // A hood has no characterId — the token is the whole handle, and it
        // is what the server resolves back against the people standing here.
        const value = person.characterId ?? person.token ?? null;
        const label = person.name ?? person.alias ?? "somebody";
        return (
          <button
            key={value ?? `hooded-${index}`}
            type="button"
            className="chip"
            disabled={!value}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(arg.name, value)}
          >
            {label}
          </button>
        );
      })}
      {more > 0 && <span className="text-sm text-muted">…and {more} more</span>}
    </div>
  );
}



export default function Feed({
  place,
  self,
  // Whether GameConfig.tupperAutocorrectEnabled is on. The server applies
  // capitalizeSentences(fixContractions(…)) to everything said through
  // db/lib/say.js, so the optimistic row applies it too — otherwise you watch
  // your own sentence rewrite itself a second after you send it.
  autocorrect = false,
  onSeen,
  // The phone's two drawers, opened from the head (ChatHead.js): everywhere
  // this character can hear, and who is standing here with the place, the
  // ways out and you. Null draws no button — the GM desk's Scene tab embeds
  // this feed and has neither.
  onOpenPlaces = null,
  onOpenAside = null,
  // A dot on ≡ when some other place has something unread, and the count on
  // the people button. Both drawn by ChatHead, decided by Chat.js.
  unreadElsewhere = false,
  hereCount = null,
  // whosHere().named for where this character stands, as { id, name,
  // updatedAt } — the @ list, and the same roster the page hands
  // CharacterMentionsProvider so a {char:…} renders back as a face.
  roster = [],
  // A GM reading from the GM seat (web/lib/feedAccess.js#loadFeedViewer): no
  // living character, or one who picked GM from the View as switch at the foot
  // of the places column. They speak nowhere and act on nobody, but they may
  // take a line down.
  gm = false,
  // speakerKey -> real name, and only ever handed to the GM seat
  // (web/lib/gmSpeakers.js). A hooded line reaches the browser with its
  // characterId withheld, so this is how the host reads the name behind one.
  gmSpeakers = null,
  // A dead player watching with no living character. They speak nowhere and
  // act on nobody either, and may take nothing down.
  ghost = false,
  // Whether this character's sheet holds an instant-camera
  // (db/lib/photoMint.js#CAMERA_SLUG). The row's 📷 is the web twin of the
  // 📸 reaction; the server re-checks the camera either way.
  hasCamera = false,
  // The GM desk's Scene tab (PLAYER-DESK.md): the same scene with no composer
  // and no sheet. A GM speaks nowhere (CHAT.md §5a), so this only removes chrome
  // that would have refused anyway.
  readOnly = false,
  // The Location's noticeboard, as cards pinned above the scene. A node
  // rather than data: Chat.js owns the board's state, because the Noticeboard
  // dialog in the right column pins to the same board this draws.
  notices = null,
  // A search hit somebody clicked: Chat.js selects the place and loads the
  // window around the seq, and hands the seq back here to scroll to.
  // { seq, at } — `at` is a timestamp, so clicking the same hit twice scrolls
  // twice.
  jump = null,
  onJump = null,
  // Zone · Location, from Chat.js. The open place is the heading under it.
  crumb = [],
  // The rows page.js server-rendered, and which place they belong to.
  // feedStore.js is a module-level client store, so its server snapshot is
  // empty by construction — without this the SERVER paint of a busy street
  // was a skeleton, and the scene only appeared once the browser had
  // hydrated. Used only while the store has nothing for that place, which
  // after hydration is never (Chat.js seeds it in a state initializer).
  fallbackPlace = null,
  fallbackRows = null,
  // whosHere() whole — named AND hoods. `roster` above is the @ list and has
  // no hoods in it on purpose; the slash commands' person picker does, because
  // Look at is the one thing you may do to somebody you cannot name.
  people = null,
  // What the composer's commands can do that a server action cannot: pick a
  // node in the Travel grid, open the Converse dialog. Chat.js owns both,
  // because both live in the right column.
  onTravelPick = null,
  onConverse = null,
  // Bumped by Chat.js on the stream's `places` event, so a key turning or
  // somebody else's /add re-reads the members strip.
  placesVersion = 0,
  // Paperwork, beside the composer rather than on the sheet
  // (docs/systemdocs/PAPERWORK.md): { canWrite, canSeal, hasBird,
  // birdSentToday }, all resolved server-side in web/lib/selfPools.js. Each
  // entry opens the SHEET's own dialog; the four actions re-check every gate.
  letters = null,
  // The hood (PROXYING.md §5). It is put up and taken off with `/conceal`;
  // these two only say what the composer is CALLED while it is on. `alias` is
  // what the room reads, which is what the box says its name is.
  concealed = false,
  alias = null,
}) {
  const placeKey = place?.placeKey ?? null;
  const stored = useFeed(placeKey);
  // "idle" | "loading" | "loaded". The empty state is only honest once the
  // backlog is actually in; before that it is the skeleton's turn.
  const historyState = useHistoryState(placeKey);
  // Which commands the open place allows (./commands.js). Recomputed per
  // place rather than filtered at use: a /roll offered in the street and
  // refused on Enter is a control that lied.
  const available = useMemo(() => commandsFor(place?.kind), [place?.kind]);
  // The street takes NO box at all — not speech, and not a command either. It
  // carried one for a while so /shout had somewhere to be typed, and then a
  // shout stopped being a thing you do out here too (commands.js), which left
  // the box with nothing to run. What sits there now is a line saying where to
  // go instead.
  // The server rows stand in only until this place's history is actually
  // loaded. Past that the store IS the scene — and it was the fallback that
  // brought a deleted line back: take the only line in a quiet street down,
  // the store empties, and the server's copy from page-load slid in behind it
  // as though nothing had happened.
  const rows =
    historyState !== "loaded" &&
    stored.length === 0 &&
    placeKey &&
    placeKey === fallbackPlace &&
    fallbackRows?.length
      ? fallbackRows
      : stored;
  const [searchOpen, setSearchOpen] = useState(false);
  // The `at` of a jump whose failure the reader has already waved away, so
  // closing the search box after a miss actually closes it.
  const [dismissedJump, setDismissedJump] = useState(null);
  const typing = typingLine(useTyping(placeKey));
  const coarse = useIsCoarsePointer();
  // The row whose ⋯ was tapped — its sheet of verbs, one open at a time.
  // Carries the same booleans the hover bar branches on (FeedRow), so the
  // sheet re-decides nothing the row hadn't already worked out.
  const [menuRow, setMenuRow] = useState(null);
  // The phone (useNarrow.js): a one-line box, the send as a glyph, and the
  // ✉ and the hood folded behind a + the way Discord's composer does it.
  const narrow = useNarrow();
  const [toolsOpen, setToolsOpen] = useState(false);
  const confirm = useConfirm();
  // The box's text. Seeded from what this tab last left unsent in THIS place
  // (./draftStore.js): Chat.js keys this component on the open place, so a
  // switch remounts it with a clean slate for everything but the words.
  const [draft, setDraft] = useState(() => readDraft(placeKey));
  useEffect(() => {
    writeDraft(placeKey, draft);
  }, [placeKey, draft]);
  const [error, setError] = useState(null);
  const [atBottom, setAtBottom] = useState(true);
  const [editingSeq, setEditingSeq] = useState(null);
  // What the camera caught, while the print is being made and after: one of
  // { loading } | { readout, photoName, line } | { error }.
  const [photo, setPhoto] = useState(null);

  // The sheet's people dialogs, mounted on the page (play/page.js). Absent
  // for a GM and on the desk's Scene tab, which is what leaves the eye off
  // those rows.
  const requestActions = useRequestActions();
  const openAction = requestActions?.open ?? null;
  // The ✉ menu's entries. Each one is shown only where the SHEET would show
  // it, off the same server-resolved gates (web/lib/selfPools.js), and each
  // opens the sheet's own dialog. The bird is the one that greys rather than
  // hides: it is a thing you have and have already used today, and saying so
  // is better than a button that vanishes overnight.
  const lettersMenu = useMemo(() => {
    if (!letters || !openAction) return [];
    const rows = [];
    if (letters.canWrite) rows.push({ mode: "write", label: "Write" });
    if (letters.canSeal) rows.push({ mode: "seal", label: "Seal" });
    if (letters.hasBird) {
      rows.push({
        mode: "bird",
        label: letters.birdSentToday ? "Sent today" : "Send by bird",
        disabled: Boolean(letters.birdSentToday),
      });
    }
    if (letters.hasBirdReply) rows.push({ mode: "birdReply", label: "Answer a letter" });
    return rows;
  }, [letters, openAction]);

  // What this place looked like the moment it was opened, plus whatever hold
  // this tab has since put on its own composer. Both are per-place, and both
  // are captured DURING a render rather than in an effect —
  // react-hooks/set-state-in-effect is an error here, and setting state in a
  // render to follow a changed prop is the pattern React documents for it.
  //
  //   mark  the seen mark as it stood on opening, which is where the NEW line
  //         goes. Frozen on purpose: marking the place read (below) moves the
  //         stored mark, and a line that chased it down the list as you read
  //         would never be anywhere useful.
  //   hold  epoch ms the composer opens again at, set from a send or from the
  //         server's own retryAfter.
  const [opened, setOpened] = useState(() => ({ placeKey, mark: peekSeen(placeKey), hold: 0 }));
  if (opened.placeKey !== placeKey) setOpened({ placeKey, mark: peekSeen(placeKey), hold: 0 });
  const newMark = opened.placeKey === placeKey ? opened.mark : null;
  const hold = opened.placeKey === placeKey ? opened.hold : 0;

  const scrollerRef = useRef(null);
  // What the scroller holds, so its height can be watched (see the
  // ResizeObserver below).
  const innerRef = useRef(null);
  const textareaRef = useRef(null);
  // { at, query, active } — where the live `@word` starts, what has been typed
  // of it, and which row of the popover is highlighted. One piece of state, so
  // a keystroke that both moves the caret and moves the highlight is one
  // render.
  const [mention, setMention] = useState(null);
  // ---- Slash commands ------------------------------------------------------
  //
  // Three pieces of state, and they are three because they change on three
  // different keystrokes.
  //
  //   slash    { query, active } while the `/` popover is open. Null the rest
  //            of the time, including all of command mode — once a command is
  //            picked there is nothing left to autocomplete.
  //   command  { entry, values } — command MODE. The chip in the box is drawn
  //            off `entry`, and the textarea holds the entry's one text arg.
  //   cmdLine  what the command answered, under the composer. Cleared on the
  //            next keystroke, so it never outlives the thing it explains.
  const [slash, setSlash] = useState(null);
  const [command, setCommand] = useState(null);
  const [cmdLine, setCmdLine] = useState(null);
  // A hood's readout, or a named person's, from `/look`. One path for both:
  // the server tells a 32-hex token from a cuid itself, so the browser never
  // learns which it sent (play/actions.js#lookAt).
  const [look, setLook] = useState(null);
  // The ✉ menu beside the composer. The composer's, not the scene's, so it
  // lives here.
  const [lettersOpen, setLettersOpen] = useState(false);
  const [refresh] = useRefresh();
  const {
    run: runCommand,
    pending: cmdPending,
    error: cmdError,
    setError: setCmdError,
  } = useActionRunner();
  // Who is in this conversation or private room, and who could be let in.
  // Loaded here rather than inside MembersStrip because `/remove`'s picker is
  // the same list, and two fetches of it would be two answers to one question.
  const [members, setMembers] = useState(null);
  const [membersNonce, setMembersNonce] = useState(0);
  const lastTypedAt = useRef(0);
  // Read inside the scroll handler and the arrival effect, where a stale
  // closure would stick the view to the wrong end of the list.
  const atBottomRef = useRef(true);
  // How tall the list was just before a page of older rows was put on top of
  // it, and where the reader was in it. Restored after layout — see the
  // useLayoutEffect below. A ref, because it is set from a fetch callback and
  // read during layout, and neither is a render.
  const anchorRef = useRef(null);
  // The state of reading further back in THIS place, so the top of the list
  // can say what it is doing.
  const backlog = useBacklog(placeKey);
  // Retries this tab has scheduled for itself after a slowmode refusal, so a
  // place change or a closed tab does not leave one to fire into nothing.
  const retryTimers = useRef(new Set());
  // Slowmode, answered rather than swallowed. The box stays TYPEABLE through
  // the hold the way Discord's does — people write while they wait — so an
  // Enter inside it has to say something, or the words just sit there and
  // nothing at all happens. The countdown chip flinches and the error line
  // says the number once.
  const [nudge, setNudge] = useState(false);
  const nudgeTimer = useRef(null);

  // ---- Slowmode ------------------------------------------------------------
  //
  // A wait, not a failure. The zone summary is the only place with one
  // (db/lib/feedAccess.js), and it used to arrive as a 429 the composer read
  // as a network error: the row went red and offered a Retry that would have
  // been refused again. Now the composer knows when it may speak, counts the
  // seconds down, and — if a 429 gets through anyway, which two tabs can
  // still manage — holds the row and sends it again itself.
  const slowmodeMs = (place?.slowmodeSeconds ?? 0) * 1000;

  // When the server will let this character speak here again, measured the
  // same way the server measures it: from their own newest line in the place.
  // That is also what seeds the countdown when a place is opened.
  const ownDeadline = useMemo(() => {
    if (slowmodeMs <= 0) return 0;
    let best = 0;
    for (const row of rows) {
      if (!row.seq || !isOwnRow(row, self.characterId, self.speakerKey) || !row.sentAt) continue;
      const at = new Date(row.sentAt).getTime();
      if (at > best) best = at;
    }
    return best > 0 ? best + slowmodeMs : 0;
  }, [rows, slowmodeMs, self.characterId]);

  const deadline = Math.max(hold, ownDeadline);

  // One re-render a second while a countdown is running, and nothing else:
  // the number itself is read off the clock in the render below, which is the
  // one place in this file where reading the clock is the point.
  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline <= Date.now()) return undefined;
    const timer = setInterval(() => {
      tick((n) => n + 1);
      if (Date.now() >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const waitSeconds = deadline > 0 ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;

  // Named, so it can schedule itself: a 429 comes back with the seconds left,
  // and the answer to it is this same call once they are up.
  const send = useCallback(
    async function send(clientId, content, attempt = 0) {
      try {
        const res = await fetch("/api/feed/say", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place: placeKey, content, clientId }),
        });
        const data = await res.json().catch(() => null);

        if (res.status === 429) {
          const wait = Math.max(1, Number(data?.retryAfter) || 1) * 1000;
          setOpened((current) =>
            current.placeKey === placeKey ? { ...current, hold: Date.now() + wait } : current,
          );
          if (attempt >= MAX_SLOWMODE_RETRIES) {
            setError(data?.error ?? "That didn't send.");
            markPendingFailed(placeKey, clientId);
            return;
          }
          // The row stays pending and the countdown explains the wait, so
          // there is nothing to tell the player that the number is not
          // already telling them.
          setError(null);
          const timer = setTimeout(() => {
            retryTimers.current.delete(timer);
            void send(clientId, content, attempt + 1);
          }, wait + 250);
          retryTimers.current.add(timer);
          return;
        }

        if (!res.ok) {
          setError(data?.error ?? "That didn't send.");
          markPendingFailed(placeKey, clientId);
          return;
        }
        setError(null);
        if (data?.row) applyRow(placeKey, data.row);
      } catch {
        setError("That didn't send.");
        markPendingFailed(placeKey, clientId);
      }
    },
    [placeKey],
  );

  // The flinch is a few hundred milliseconds; a tab closed inside one should
  // not leave a timer holding a setState.
  useEffect(() => {
    return () => {
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    };
  }, []);

  // A scheduled retry outlives a change of place on purpose — it is still
  // carrying words somebody typed, and the send it will make names the place
  // they typed them in. Only a closed tab drops it.
  useEffect(() => {
    const timers = retryTimers.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // "Somebody is writing something", the web half of it. Fire-and-forget: the
  // answer is never read, and a failure means one missing line rather than
  // anything a player has to be told about.
  const pingTyping = useCallback(() => {
    if (!placeKey || !place?.canSpeak) return;
    const now = Date.now();
    if (now - lastTypedAt.current < TYPING_PING_MS) return;
    lastTypedAt.current = now;
    fetch("/api/feed/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place: placeKey }),
    }).catch(() => {});
  }, [placeKey, place?.canSpeak]);

  const matches = useMemo(
    () => (mention ? matchRoster(roster, mention.query) : []),
    [mention, roster],
  );

  const cmdMatches = useMemo(
    () => (slash ? matchCommands(available, slash.query) : []),
    [slash, available],
  );

  // Only two kinds of place have a guest list at all: a conversation, and a
  // PRIVATE room. Asked about anywhere else, placeMembers() answers with a
  // null `members` rather than a refusal — but not asking is cheaper.
  const hasMembers =
    place?.kind === "conv" || (place?.kind === "room" && place?.roomKind === "PRIVATE");

  useEffect(() => {
    if (!hasMembers || !placeKey) return undefined;
    let cancelled = false;
    placeMembers(placeKey)
      .then((res) => {
        // Stamped with the place it answers for. The state outlives a walk
        // across town, and an unstamped answer would draw the last room's
        // guest list over this one's for a frame.
        if (!cancelled) setMembers({ placeKey, res });
      })
      .catch(() => {
        if (!cancelled) {
          setMembers({ placeKey, res: { ok: false, error: "Couldn't read who is in here." } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasMembers, placeKey, membersNonce, placesVersion]);

  // And once a minute regardless. The strip learns about a change from the
  // stream's `places` frame and from a message in this place (Chat.js), but
  // neither fires for a key GRANTED to somebody else while nobody is talking —
  // there is no frame for that at all — so the list could sit wrong for as
  // long as the room stayed quiet. A minute is slow enough to cost nothing and
  // quick enough that nobody notices they waited.
  const reloadMembers = useCallback(() => setMembersNonce((n) => n + 1), []);
  useVisiblePoll(reloadMembers, MEMBERS_REFRESH_MS, { enabled: Boolean(hasMembers && placeKey) });
  const membersData = members?.placeKey === placeKey ? members.res : null;

  // The `@word` under the caret, recomputed on every edit. In the handler, not
  // an effect: the caret is a DOM fact and reading it during a render would be
  // both impure and a frame late.
  const onDraftChange = useCallback(
    (event) => {
      const value = event.target.value;
      const caret = event.target.selectionStart ?? value.length;
      // The last command's answer explains the box as it was a moment ago, so
      // it goes the instant the box changes.
      setCmdLine(null);
      setCmdError(null);

      // Already in command mode: the box is the command's text argument, and
      // neither menu belongs in it.
      if (command) {
        setDraft(value);
        pingTyping();
        return;
      }

      // `/shout ` — the whole name and a space. Discord's composer does this,
      // and it is how anybody who knows the command avoids the menu entirely.
      const exact = exactCommand(available, value);
      if (exact) {
        setDraft("");
        setSlash(null);
        setMention(null);
        setCommand({ entry: exact, values: {} });
        return;
      }

      setDraft(value);
      const found = slashQueryAt(value, caret);
      if (found) {
        setSlash({ ...found, active: 0 });
        setMention(null);
        pingTyping();
        return;
      }
      setSlash(null);
      const mentioned = mentionQueryAt(value, caret);
      setMention(mentioned ? { ...mentioned, active: 0 } : null);
      pingTyping();
    },
    [pingTyping, command, available, setCmdError],
  );

  // Swaps the half-typed `@bar` for the token the row is actually made of.
  // {char:<id>|<Name>} is what goes on the wire, on both faces: the outbox
  // turns it into a Discord role mention on the way out, and prepareSpeech
  // turns a Discord one back into this on the way in, so the ROW is
  // face-neutral.
  //
  // The name half is written here so the composer's own preview reads right,
  // and the server OVERWRITES it on the way in (db/lib/say.js#prepareSpeech
  // via stampMentionNames) — this copy is a convenience, never the record. It
  // is the name the picker offered, which is already the presented one:
  // whosHere() hands the @ menu no hoods.
  const pickMention = useCallback(
    (person) => {
      setMention((current) => {
        if (!current) return null;
        const before = draft.slice(0, current.at);
        const after = draft.slice(current.at + 1 + current.query.length);
        const token = `{char:${person.id}${person.name ? `|${person.name}` : ""}} `;
        setDraft(`${before}${token}${after}`);
        const caret = before.length + token.length;
        // After the value lands, or setSelectionRange moves a caret in the old
        // string. Not an effect — this is the tail of a click.
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(caret, caret);
        });
        return null;
      });
    },
    [draft],
  );

  // ---- Command mode --------------------------------------------------------

  // Leaving command mode. The typed text comes BACK into the box rather than
  // being thrown away — Escape on a half-written /report should not cost
  // somebody the paragraph they had written into it.
  const exitCommand = useCallback(
    (keepText = "") => {
      setCommand(null);
      setSlash(null);
      setCmdError(null);
      setDraft(keepText);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [setCmdError],
  );

  // `keepText` is for the speech-mode control below, which is a change of
  // VOICE rather than a change of subject — somebody who typed a sentence and
  // then decided it was out of character should not have to type it again.
  // The `/` popover still clears, since there the text WAS the command name.
  const pickCommand = useCallback((entry, keepText = "") => {
    setSlash(null);
    setMention(null);
    setDraft(keepText);
    setCmdLine(null);
    setCommand({ entry, values: {} });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  // ---- Speak / Shout / OOC -------------------------------------------------
  //
  // Three ways of talking, as one control. Each of the two that are not plain
  // speech is ALREADY a command in ./commands.js, so this drives command mode
  // rather than adding a third send path: runCurrent() below does the sending,
  // the clearing, the length cap and the hand-back-on-refusal, and all of that
  // stays written once. The control is the affordance; `command` is the state.
  //
  // Which modes are offered comes off the same `where` gate the slash list
  // takes, so a place that cannot be shouted in never shows a Shout button —
  // and oocHere/shoutHere re-check it anyway, since a server action is a
  // public endpoint.
  const speechModes = useMemo(
    () =>
      [
        { mode: "speak", label: "Speak", command: null },
        { mode: "shout", label: "Shout", command: "shout" },
        { mode: "ooc", label: "OOC", command: "ooc" },
      ].filter((m) => !m.command || available.some((entry) => entry.name === m.command)),
    [available],
  );
  // Derived, never stored — two copies of "which voice is this" could disagree,
  // and the one in `command` is the one that actually sends. Null while some
  // OTHER command is open (/move, /look), which leaves all three unpressed:
  // honest, since none of them is what the box would run.
  const speechMode = command
    ? (speechModes.find((m) => m.command === command.entry.name)?.mode ?? null)
    : "speak";
  const pickSpeechMode = useCallback(
    (mode) => {
      const picked = speechModes.find((m) => m.mode === mode);
      if (!picked) return;
      if (!picked.command) {
        exitCommand(draft);
        return;
      }
      const entry = available.find((e) => e.name === picked.command);
      if (entry) pickCommand(entry, draft);
    },
    [available, draft, exitCommand, pickCommand, speechModes],
  );

  // Looking somebody up from `/look`. ONE path for a name and for a hood: the
  // server tells a 32-hex token from a character id itself, so the browser is
  // never told which of the two it is holding (play/actions.js#lookAt).
  const onLookUp = useCallback((ref) => {
    setLook({ loading: true });
    lookAt(ref)
      .then((res) => {
        if (res?.ok) setLook({ readout: res.readout });
        else setLook({ error: res?.error ?? "You can't see them." });
      })
      .catch(() => setLook({ error: "You can't see them." }));
  }, []);

  // What a command can reach that a server action cannot. Chat.js owns the
  // travel grid and the Converse dialog, so both arrive as callbacks.
  const commandCtx = useMemo(
    () => ({
      placeKey,
      travelTo: onTravelPick,
      converse: onConverse,
      lookAt: onLookUp,
      // /conceal changes the name every row this composer writes will wear,
      // and that name is a SERVER prop (page.js -> Chat.js -> here), so the
      // page has to re-read it. The composer's own hood button used to be the
      // one caller that did this; /conceal is the only way up or down now.
      refresh,
    }),
    [placeKey, onTravelPick, onConverse, onLookUp, refresh],
  );

  // The word on the send button. A command DOES something, so it runs by
  // default — but /ooc and /shout only put words in the room, and "Run" read
  // like a program was about to start rather than a line about to be said.
  // Each entry says so itself (commands.js), so this stays one lookup.
  const sendLabel = command ? (command.entry.verb ?? "Run") : "Send";

  // Paperwork — Write, Seal, the bird. Not a place's affordance: these are
  // things you do with your own hands wherever you are standing. Folded INSIDE
  // the box when there is a box, which is Discord's shape and the whole point
  // of this row; beside the sentence when there isn't one, because a ghost has
  // no composer and still has hands.
  //
  // The hood used to sit here too. It is /conceal now and only /conceal.
  const composerTools =
    lettersMenu.length > 0 || (narrow && speechModes.length > 1) ? (
      <span className={narrow ? "chat-composer-tools chat-composer-tools--folded" : "chat-composer-tools"}>
        {narrow ? (
          <span className="chat-tool-wrap">
            <IconButton
              icon={PlusIcon}
              label="More"
              size="lg"
              aria-haspopup="menu"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((was) => !was)}
            />
            {toolsOpen && (
              <div className="chat-menu chat-menu--left" role="menu" aria-label="More">
                {/* The phone's Speak / Shout / OOC. Radios rather than
                    buttons — they are three states of one thing, and one
                    of them is always on — so the menu says which voice
                    the box is currently in without a second control. */}
                {speechModes.length > 1 &&
                  speechModes.map((m) => (
                    <button
                      key={m.mode}
                      type="button"
                      role="menuitemradio"
                      aria-checked={speechMode === m.mode}
                      className="menu-item"
                      onClick={() => {
                        setToolsOpen(false);
                        pickSpeechMode(m.mode);
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                {lettersMenu.map((entry) => (
                  <button
                    key={entry.mode}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={entry.disabled}
                    onClick={() => {
                      setToolsOpen(false);
                      openAction?.(entry.mode);
                    }}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            )}
          </span>
        ) : (
          <>
            {lettersMenu.length > 0 && (
              <span className="chat-tool-wrap">
                <IconButton
                  icon={QuillIcon}
                  label="Letters"
                  aria-haspopup="menu"
                  aria-expanded={lettersOpen}
                  onClick={() => setLettersOpen((was) => !was)}
                />
                {lettersOpen && (
                  <div className="chat-menu" role="menu" aria-label="Letters">
                    {lettersMenu.map((entry) => (
                      <button
                        key={entry.mode}
                        type="button"
                        role="menuitem"
                        className="menu-item"
                        disabled={entry.disabled}
                        onClick={() => {
                          setLettersOpen(false);
                          openAction?.(entry.mode);
                        }}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                )}
              </span>
            )}
          </>
        )}
      </span>
    ) : null;

  // Enter, in command mode. Every gate here is a hint — each command's `run`
  // lands on a server action that re-resolves the actor and re-checks
  // everything, so a missing argument caught here only spares a round trip.
  const runCurrent = useCallback(() => {
    if (!command) return;
    const { entry, values } = command;
    const textArg = textArgOf(entry);
    const body = draft.trim();
    if (textArg && !body) {
      setCmdError("Write something first.");
      return;
    }
    if (textArg?.maxLength && body.length > textArg.maxLength) {
      setCmdError(`That is ${body.length} characters, and the most is ${textArg.maxLength}.`);
      return;
    }
    const missing = pendingArg(entry, values);
    if (missing) {
      setCmdError("Pick one first.");
      return;
    }
    const filled = textArg ? { ...values, [textArg.name]: body } : values;
    // Cleared HERE, not in onOk. /shout fans out to every place that heard it
    // and only then resolves, so the line was visible in the feed for seconds
    // while the words still sat in the box — and if anything downstream threw,
    // onOk never ran and they sat there for good. The plain send at submit()
    // below has always cleared optimistically; this is the same rule for the
    // command half, with onFail handing the words back on a refusal.
    setCommand(null);
    setDraft("");
    runCommand(
      // `run` may answer with nothing at all — /look and /converse only open
      // something — and useActionRunner reads a missing `ok` as a failure.
      async () => (await entry.run(filled, commandCtx)) ?? { ok: true },
      undefined,
      {
        onOk: (res) => {
          setCmdLine(res?.line ?? null);
        },
        // Back exactly as it was: the chip, the arguments already picked, and
        // the sentence. Retyping a refused shout is the one thing worse than
        // watching it sit there.
        onFail: () => {
          setCommand({ entry, values });
          setDraft(body);
          requestAnimationFrame(() => textareaRef.current?.focus());
        },
      },
    );
  }, [command, draft, runCommand, commandCtx, setCmdError]);

  useComposerAutosize(textareaRef, draft, command);

  // What the count under the box says, or null for nothing at all. Three
  // states past silence: the plain count as they approach one message, then
  // what the split will do, then a refusal once it is past the ceiling.
  //
  // chunkMessage is the same splitter the server runs (db/lib/say.js), and
  // db/lib/chunkText.js has no requires precisely so a client component can
  // call it — so the number shown here is the number that will happen.
  const sayCount = useMemo(() => {
    const length = draft.trim().length;
    if (length < COUNT_FROM) return null;
    if (length <= MESSAGE_LIMIT) return { label: `${length}/${MESSAGE_LIMIT}`, over: false };
    const pieces = chunkMessage(draft.trim()).length;
    if (pieces > MAX_SAY_PIECES) return { label: tooManyPieces(pieces), over: true };
    return { label: `sends as ${pieces} messages`, over: false };
  }, [draft]);

  const submit = useCallback(() => {
    const content = draft.trim();
    if (!content || !placeKey) return;
    // Inside the hold. The draft is kept — it is theirs, and they will send
    // it in a second — and the chip is what says so.
    if (deadline > Date.now()) {
      setError(`Slowmode. Wait ${Math.max(1, Math.ceil((deadline - Date.now()) / 1000))} s.`);
      setNudge(true);
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(() => setNudge(false), 500);
      return;
    }
    // Over 2000 this goes out as several messages (db/lib/say.js#sayInPieces).
    // Past the ceiling it does not go out at all, and the composer says so
    // here rather than letting the server be the first to mention it — which
    // is the whole complaint this fixed. Same sentence the server would give.
    const pieces = chunkMessage(content);
    if (pieces.length > MAX_SAY_PIECES) {
      setError(tooManyPieces(pieces.length));
      return;
    }

    const clientId = newClientId();
    setDraft("");
    setMention(null);
    setError(null);
    addPending(placeKey, {
      clientId,
      seq: null,
      // Shaped the way the server will shape it (db/lib/archive.js#feedRowShape):
      // a hooded send carries the key and no id, so the optimistic row and the
      // confirmed one agree about which lines are yours.
      characterId: self.aliased ? null : self.characterId,
      speakerKey: self.aliased ? self.speakerKey : null,
      name: self.name,
      avatarVersion: self.aliased ? null : self.avatarVersion,
      avatarPath: self.avatarPath,
      // What the SERVER will store, not what was typed. Both transforms, in
      // the order db/lib/say.js#transformSpeech runs them.
      //
      // The FIRST piece only, when this is a split send: the server puts the
      // clientId on piece 1 and this row is the twin it replaces. The rest
      // arrive on the stream a moment later. Client and server call the same
      // chunkMessage on the same string, so they cannot disagree about where
      // the break falls.
      content: autocorrect
        ? capitalizeSentences(fixContractions(pieces[0]))
        : pieces[0],
      sentAt: new Date().toISOString(),
    });
    // Optimistic, so a second Enter in the same second meets the countdown
    // rather than the server's refusal.
    if (slowmodeMs > 0) {
      setOpened((current) => (current.placeKey === placeKey ? { ...current, hold: Date.now() + slowmodeMs } : current));
    }
    atBottomRef.current = true;
    setAtBottom(true);
    // The RAW text goes to the server, which runs the same transforms itself
    // — sending the transformed copy would run them twice.
    void send(clientId, content);
  }, [draft, placeKey, self, send, autocorrect, slowmodeMs, deadline]);

  const onRetry = useCallback(
    (clientId) => {
      const row = retryPending(placeKey, clientId);
      if (row) void send(clientId, row.content);
    },
    [placeKey, send],
  );

  // The window, checked in an event handler where reading the clock is both
  // legal and correct. The refusal is the bot's word for word, so a player
  // hears one rule on both faces.
  const withinWindow = (sentAt) => Date.now() - new Date(sentAt ?? 0).getTime() < EDIT_WINDOW_MS;
  const TOO_LATE = "You can't edit that any more.";

  const onEdit = useCallback((seq, sentAt) => {
    if (!withinWindow(sentAt)) {
      setError(TOO_LATE);
      return;
    }
    setError(null);
    setEditingSeq(seq);
  }, []);

  const onCancelEdit = useCallback(() => setEditingSeq(null), []);

  // The row swaps in from the stream, so nothing is written into the store
  // here: the server is the one that decides what the message now says.
  const onSaveEdit = useCallback(async (seq, content) => {
    setEditingSeq(null);
    try {
      const res = await fetch("/api/feed/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seq, content }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "That didn't change.");
        return;
      }
      setError(null);
    } catch {
      setError("That didn't change.");
    }
  }, []);

  const onDelete = useCallback(
    async (seq, sentAt) => {
      if (!withinWindow(sentAt)) {
        setError(TOO_LATE);
        return;
      }
      if (!(await confirm({ title: "Delete this line?", message: "It goes from here and from Discord.", confirmLabel: "Delete" }))) {
        return;
      }
      try {
        const res = await fetch("/api/feed/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seq }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error ?? "That didn't go.");
          return;
        }
        setError(null);
      } catch {
        setError("That didn't go.");
      }
    },
    [confirm],
  );

  // ---- Somebody else's line ------------------------------------------------

  // Look at, from the row rather than from a picker — and pressed against the
  // ROW rather than the person. The browser sends a seq and nothing else; the
  // server resolves who said it, whether they were hooded at the time and
  // whether this reader may see the place (db/lib/examineRow.js). That is what
  // lets the eye sit on a hooded line at all, and it answers for the hood worn
  // when the line was said rather than the one being worn now.
  //
  // It no longer goes through the sheet's dialog, which resolved a person by
  // id: the readout is the same one either way, and this is the version that
  // never needs the id.
  const onLookAt = useCallback((seq) => {
    if (!seq) return;
    setLook({ loading: true });
    lookAtRow(seq)
      .then((res) => {
        if (res?.ok) setLook({ readout: res.readout });
        else setLook({ error: res?.error ?? "You can't see them." });
      })
      .catch(() => setLook({ error: "You can't see them." }));
  }, []);

  // Photograph. The camera is not spent (db/lib/photoMint.js) and the print
  // is deduped per (photographer, row) server-side, so a second press on the
  // same line gives back the same refusal the bot's 📸 does rather than a
  // second Tag row.
  const onPhotograph = useCallback((seq) => {
    setPhoto({ loading: true });
    photographRow(seq)
      .then((res) => {
        if (res?.ok) setPhoto({ readout: res.readout, photoName: res.photoName, line: res.line });
        else setPhoto({ error: res?.error ?? "The camera caught nothing." });
      })
      .catch(() => setPhoto({ error: "The camera caught nothing." }));
  }, []);

  // ⭐ — the web twin of the reaction in Discord. It writes the same `Note`
  // row, and the server upsert makes a second press on the same line a no-op
  // rather than a second note, so this needs no pressed state of its own.
  // The answer goes on the composer's quiet line, where every other one-shot
  // command answer already lands.
  const onStar = useCallback((seq) => {
    setCmdError(null);
    starRow(seq)
      .then((res) => {
        if (res?.ok) setCmdLine(res.line ?? "Saved to your Notes.");
        else setCmdError(res?.error ?? "That line is gone.");
      })
      .catch(() => setCmdError("Could not reach the server. Nothing was changed."));
  }, [setCmdError]);

  // A GM taking a line down. Same route as Delete, with no character on
  // the session — db/lib/say.js#deleteSpeech skips the owner and the window
  // for a GM, and the route is the one that decides they are one.
  const onRemove = useCallback(
    async (seq) => {
      if (
        !(await confirm({
          title: "Remove this line?",
          message: "It goes from here and from Discord.",
          confirmLabel: "Remove it",
        }))
      ) {
        return;
      }
      try {
        const res = await fetch("/api/feed/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seq }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error ?? "That didn't go.");
          return;
        }
        setError(null);
      } catch {
        setError("That didn't go.");
      }
    },
    [confirm],
  );

  // One page further back, fetched when the reader gets near the top.
  //
  // It lives here rather than beside the other history fetches in Chat.js
  // because the scroll position is the trigger AND the thing that has to be
  // put back afterwards: the anchor has to be measured in the beat between
  // the rows arriving and React laying them out, which is this component's
  // own render. Chat.js loads the FIRST page of a place; this loads the rest.
  const reachBack = useCallback(() => {
    // The two pseudo-places never reach this component at all — Chat.js
    // draws ./FactionPanel.js and ./DmPane.js instead — so a real place is
    // the only thing a mounted Feed can be looking at.
    if (!placeKey) return;
    const state = backlogOf(placeKey);
    if (state.loading || state.exhausted) return;
    // Nothing on screen yet means the first page is still out. It will bring
    // the cursor this pages from, so there is nothing to ask for.
    const cursor = oldestSeq(placeKey);
    if (!cursor) return;
    setBacklog(placeKey, { loading: true });
    fetch(
      `/api/feed/history?place=${encodeURIComponent(placeKey)}&before=${encodeURIComponent(cursor)}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) {
          setBacklog(placeKey, { loading: false });
          return;
        }
        // Measured HERE, before seedRows re-renders the list — the DOM is
        // still the old, shorter one at this point. Restoring it is the
        // useLayoutEffect below.
        // Measured only when there is actually something to put on top, and
        // measured HERE, before seedRows re-renders — the DOM is still the
        // old, shorter one at this point. An anchor set for a page that
        // turned out to be empty would sit unclaimed until the next line
        // somebody spoke, and then yank the reader for no reason.
        //
        // No staleness guard needed beyond that: Chat.js keys this component
        // on the place, so a reader who walked away took this whole closure's
        // component with them.
        const older = Array.isArray(data.rows) ? data.rows : [];
        if (older.length > 0) {
          const el = scrollerRef.current;
          if (el) anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
          seedRows(placeKey, older);
        }
        setBacklog(placeKey, {
          loading: false,
          exhausted: Boolean(data.exhausted),
          floored: Boolean(data.floored),
        });
      })
      .catch(() => {
        // Left un-exhausted on purpose: a failed reach is worth trying again
        // on the next scroll, unlike an honest end of the road.
        setBacklog(placeKey, { loading: false });
      });
  }, [placeKey]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
    atBottomRef.current = near;
    setAtBottom(near);
    // Reading to the bottom is what clears the unread dot. Written on the
    // scroll, not on selection, so opening a busy room and scrolling away
    // still leaves the dot for what you have not read.
    if (near && placeKey) onSeen?.(placeKey, newestSeq(placeKey));
    // …and reading to the top is what asks for more.
    if (el.scrollTop <= REACH_PX) reachBack();
  }, [placeKey, onSeen, reachBack]);

  // A feed that does not overflow its scroller can never fire the handler
  // above — there is nowhere to scroll — so a page that came back short of a
  // screenful would sit there looking like the whole of a room's history. One
  // page at a time until it either fills the box or runs out, which bounds
  // this at "enough to scroll" rather than at the whole backlog.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    if (historyState !== "loaded") return undefined;
    if (el.scrollHeight > el.clientHeight) return undefined;
    reachBack();
    return undefined;
  }, [rows, historyState, reachBack]);

  // Put the reader back where they were after a page of older rows lands on
  // top of the list.
  //
  // Without this, scrolling up to read is self-defeating: the browser keeps
  // scrollTop where it was, so a hundred rows arriving ABOVE that point shove
  // the line somebody was reading down off the bottom of the screen, and the
  // view is suddenly parked in the middle of a conversation from an hour
  // earlier. Adding the height the list grew by holds the same line under the
  // same pixel.
  //
  // useLayoutEffect, not useEffect: this has to happen in the same frame the
  // rows are painted, or the jump is visible.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const el = scrollerRef.current;
    if (!el) return;
    const grew = el.scrollHeight - anchor.height;
    if (grew <= 0) return;
    el.scrollTop = anchor.top + grew;
  }, [rows]);

  // Scroll follows only a reader who is already at the bottom. Yanking
  // somebody back down while they are reading further up is the single most
  // annoying thing a chat window can do.
  // Only a DOM call, never a setState: react-hooks/set-state-in-effect is an
  // error here, and a "you have unread" flag would have needed one. Showing
  // the pill whenever the reader is scrolled up says the same thing without
  // a second piece of state to keep honest.
  // Scrolls the LIST, not the document: scrollIntoView walks every scrollable
  // ancestor, so on a phone it dragged the whole page down under the header
  // every time a row landed.
  //
  // On the CONTENT's size, not on the row list. A new row is one thing that
  // makes the scene taller; the notice cards landing at the top of the
  // street, a face loading into a run, the members strip above the box
  // changing height and shrinking the box — each of those used to shove the
  // reader off the bottom with nothing to put them back. A ResizeObserver on
  // the scroller and on what it holds catches all of them, after layout.
  useEffect(() => {
    const el = scrollerRef.current;
    const inner = innerRef.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return undefined;
    const stick = () => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    };
    const observer = new ResizeObserver(stick);
    observer.observe(el);
    observer.observe(inner);
    return () => observer.disconnect();
    // On the place rather than once: a mount that began with no place had no
    // scroller to watch, and the one that appears with the place needs one.
  }, [placeKey]);

  // Changing place lands the reader at the newest line of the new place, the
  // way opening a channel does. The ref rather than state, so this makes no
  // render of its own.
  useEffect(() => {
    atBottomRef.current = true;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [placeKey]);

  // A search hit. The row is already in the store by the time this runs —
  // Chat.js loads the window around the seq before it hands the jump down —
  // so this is only the scroll and the flash. DOM calls, no state: the
  // highlight is an attribute the CSS animates and then nobody looks at
  // again.
  useEffect(() => {
    // Only once the place it names is the place on screen: setting the hash
    // and setting this happen together, but the hashchange that swaps the
    // place arrives a beat later.
    if (!jump?.seq || jump.placeKey !== placeKey) return undefined;
    const el = scrollerRef.current;
    if (!el) return undefined;
    const row = el.querySelector(`[data-seq="${CSS.escape(String(jump.seq))}"]`);
    if (!row) return undefined;
    // The reader is being taken somewhere on purpose, so the follow-the-bottom
    // rule stands down until they scroll again.
    atBottomRef.current = false;
    row.scrollIntoView({ block: "center" });
    row.setAttribute("data-hit", "true");
    const timer = setTimeout(() => row.removeAttribute("data-hit"), 2000);
    return () => clearTimeout(timer);
  }, [jump, placeKey]);

  // What actually clears the unread dot.
  //
  // This used to hang off the scroll handler alone, which meant a feed short
  // enough to fit on the screen never marked anything: the place you had just
  // spoken in went unread the moment you left it and stayed that way. So it
  // runs on opening a place and on every line that lands in it — while the
  // tab is in front of you and you are at the bottom of the list, which is
  // what "read" means. markSeen writes localStorage and notifies its own
  // store; it is not a setState, so an effect is where it belongs.
  useEffect(() => {
    if (!placeKey) return undefined;
    const catchUp = () => {
      if (document.visibilityState !== "visible") return;
      if (!atBottomRef.current) return;
      onSeen?.(placeKey, newestSeq(placeKey));
    };
    catchUp();
    // Lines that landed while the tab was in the background are read the
    // moment it comes back to the front.
    document.addEventListener("visibilitychange", catchUp);
    return () => document.removeEventListener("visibilitychange", catchUp);
  }, [placeKey, rows, onSeen]);

  // Where the NEW line goes: above the first row said since this place was
  // opened that somebody ELSE said. Your own line never gets one over it —
  // you were there — so speaking in a room you had read to the end does not
  // draw a divider above your own sentence.
  //
  // A place with no mark at all (never opened in this browser) gets no line;
  // seedSeenIfFresh has already caught a first visit up, so the only rows
  // this leaves undivided are ones nobody was waiting on.
  const newAt = useMemo(() => {
    if (!newMark) return null;
    let mark;
    try {
      mark = BigInt(newMark);
    } catch {
      return null;
    }
    for (const row of rows) {
      if (!row.seq || isOwnRow(row, self.characterId, self.speakerKey)) continue;
      try {
        if (BigInt(row.seq) > mark) return row.seq;
      } catch {
        return null;
      }
    }
    return null;
  }, [rows, newMark, self.characterId]);

  // Looks BACK at the previous row rather than carrying a running variable
  // forward: react-hooks/immutability forbids reassigning a closure variable
  // inside a render, and the answer is the same either way.
  //
  // `mine` is what draws ✎ and ✕: a confirmed row of this character's. The
  // five-minute window is NOT decided here — the clock moves while the page
  // sits open, and a render that read it would be deciding on a stale one (and
  // is impure besides). It is checked when the button is pressed, and again by
  // the server, which is the only check that counts.
  // The seq the feed was already showing when this place first painted.
  // Anything above it ARRIVED, and only an arrival is worth animating.
  //
  // A lazily-filled ref rather than state, deliberately: the repo lints
  // react-hooks/set-state-in-effect as an error, and this needs no re-render
  // of its own — it is read during the same render that draws the rows. It is
  // reset when the place changes, because the next place's backlog is a
  // backlog too.
  const liveAfter = useRef({ placeKey: null, seq: 0 });
  if (liveAfter.current.placeKey !== placeKey) {
    liveAfter.current = {
      placeKey,
      seq: rows.reduce((hi, r) => (Number(r.seq) > hi ? Number(r.seq) : hi), 0),
    };
  }
  const liveFloor = liveAfter.current.seq;

  // How many lines are under the NEW mark, for the pill that floats over the
  // feed. `newAt` is the first row somebody else said since this place was
  // last read, so everything from it down is what the reader has not seen.
  // Nothing to count (no mark, or caught up) reads as a plain "New messages".
  const newCount = useMemo(() => {
    if (!newAt) return 0;
    const from = rows.findIndex((row) => row.seq === newAt);
    return from < 0 ? 0 : rows.length - from;
  }, [rows, newAt]);

  // Somebody born since the page painted is not in the directory the server
  // seeded, so a hood they put on would read as the bare alias until a reload.
  // One re-ask, throttled, the first time a row turns up under a key this
  // does not know — the same shape GmAside.js loads its place with. Never in
  // the player seat: there is no directory there to miss anything from.
  const [speakers, setSpeakers] = useState(gmSpeakers);
  const askedForSpeakersAt = useRef(0);
  useEffect(() => {
    if (!gm || !gmSpeakers) return undefined;
    const missing = rows.some((row) => row.alias && row.speakerKey && !speakers?.[row.speakerKey]);
    if (!missing) return undefined;
    const now = Date.now();
    if (now - askedForSpeakersAt.current < SPEAKER_REFRESH_MS) return undefined;
    askedForSpeakersAt.current = now;
    let cancelled = false;
    gmSpeakerNames()
      .then((res) => {
        if (!cancelled && res?.ok) setSpeakers(res.speakers);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gm, gmSpeakers, rows, speakers]);

  const withRuns = useMemo(
    () =>
      rows.map((row, i) => {
        const prev = i > 0 ? rows[i - 1] : null;
        const at = row.sentAt ? new Date(row.sentAt).getTime() : 0;
        const prevAt = prev?.sentAt ? new Date(prev.sentAt).getTime() : 0;
        const system = row.source === "SYSTEM";
        // A hooded row somebody else said carries no characterId at all — see
        // db/lib/archive.js#feedRowShape for why — so runs group on whichever
        // handle the row has. `speakerKey` is stable per speaker and useless
        // to the browser for anything else, which is the point.
        const who = (r) => r?.speakerKey ?? r?.characterId ?? null;
        const startsRun =
          !prev || prev.source === "SYSTEM" || who(prev) !== who(row) || at - prevAt > RUN_GAP_MS;
        // A GM watching with no living character has `self.characterId` null,
        // and so does a SYSTEM line's `row.characterId` — so without the first
        // half of this, every ownerless line in the scene wore Change and Take
        // back as if the GM had said it.
        // Your own lines, hooded ones included — feedStore.js#isOwnRow is the
        // one place that knows an aliased row carries a key instead of an id.
        // Only ever a hint: Change and Delete both re-resolve the actor
        // from the session.
        const mine = Boolean(row.seq) && isOwnRow(row, self.characterId, self.speakerKey);
        const theirs = Boolean(row.seq) && !system && Boolean(who(row)) && !mine;
        // THE HOOD RULE IS GONE, and the eye is offered on every line
        // somebody else said. It used to be withheld from a row written under
        // an alias, because opening a dialog on its character id would have
        // been looking a hood up BY ID — but that was a fact about how the
        // eye was wired, not a rule anybody wanted. Speaking in front of
        // somebody is exactly what lets them look at you.
        //
        // It is pressed against a SEQ now, the way the camera beside it always
        // was: the server resolves the speaker itself, so the page can offer a
        // look at a hood without ever being told who is under it, and a
        // photograph of a hood is still a photograph of a hood
        // (db/lib/examineRow.js).
        // A GHOST may look. They watch the whole board and could do nothing with any of it, which
        // was a gap rather than a rule — lookAtRow resolves them to their last body and the place
        // gate is the same one their feed already answers to (db/lib/examineRow.js).
        //
        // Not the camera, though: a photograph freezes a reading onto a real Tag row that somebody
        // has to be holding a camera to take, and a ghost holds nothing. `!gm && !ghost` still means
        // "has a living character" there, and photographRow refuses a viewer without one.
        const canLook = theirs && !gm;
        const canPhoto = theirs && !gm && !ghost && hasCamera;
        const canRemove = gm && Boolean(row.seq) && !system;
        // Same rule as canLook: a note is filed under a living character, and
        // a watcher of either kind has none. It used to draw for every row.
        const canStar = row.seq != null && !gm && !ghost;
        // What the host reads behind the alias. Any row said under a name that
        // is not the speaker's own — a hood, or a forced name like Apex Form's
        // Beast — carries `alias` plus the `speakerKey` that names them in the
        // directory. The player seat never has a directory, so this is always
        // null there and the alias stands alone, which is the whole point of
        // wearing one.
        const realName = gm && row.alias && row.speakerKey ? (speakers?.[row.speakerKey] ?? null) : null;
        return {
          row,
          realName,
          startsRun,
          mine,
          system,
          canLook,
          canPhoto,
          canRemove,
          canStar,
          newLine: Boolean(row.seq) && row.seq === newAt,
        };
      }),
    [rows, self.characterId, newAt, gm, speakers, ghost, hasCamera, openAction],
  );

  if (!place) {
    return (
      <div className="chat-main">
        <div className="chat-feed">
          <EmptyState>Nowhere is open.</EmptyState>
        </div>
      </div>
    );
  }

  // A search hit that went nowhere. Chat.js loads the window around the seq
  // and then opens the place, so by the time this place's history is LOADED
  // the line should be among its rows — and if it is not (a line deleted
  // between the search and the click, a window request that failed), the box
  // closing on nothing at all reads as a broken button. So the box comes back
  // and says so. Derived from the rows rather than from the DOM, and derived
  // rather than stored: react-hooks/set-state-in-effect is an error here.
  const jumpMissed =
    Boolean(jump?.seq) &&
    jump.placeKey === placeKey &&
    historyState === "loaded" &&
    jump.at !== dismissedJump &&
    !rows.some((row) => String(row.seq) === String(jump.seq));
  const showSearch = Boolean(onJump) && (searchOpen || jumpMissed);
  const closeSearch = () => {
    setSearchOpen(false);
    setDismissedJump(jump?.at ?? null);
  };

  // The head is ChatHead.js: the name, where you are standing above it, the
  // place's own words under it as one line you open, and — on a phone — the
  // two drawer buttons either side. Search is the head's trailing control.
  const description = place?.description?.trim() || "";
  return (
    <div className="chat-main">
      <ChatHead
        name={place.name}
        crumb={crumb}
        description={description}
        onOpenPlaces={onOpenPlaces}
        onOpenAside={onOpenAside}
        unreadElsewhere={unreadElsewhere}
        hereCount={hereCount}
        trailing={
          onJump ? (
            <IconButton
              icon={SearchIcon}
              label="Search what was said"
              size={narrow ? "lg" : "sm"}
              aria-expanded={showSearch}
              onClick={() => (showSearch ? closeSearch() : setSearchOpen(true))}
            />
          ) : null
        }
      />

      {/* Who is in this conversation or private room, and the two buttons that
          change it. Only those two kinds of place have one — MembersStrip
          draws nothing when placeMembers() answers with no list. */}
      {hasMembers && !readOnly && (
        <MembersStrip placeKey={placeKey} data={membersData} onChanged={reloadMembers} />
      )}

      {showSearch && (
        <FeedSearch
          place={place}
          notice={jumpMissed ? "Couldn't find that line." : null}
          onClose={closeSearch}
          onPick={(hitPlace, seq) => {
            // Not dismissed: if this hit turns out to be gone too, the box has
            // to come back and say so rather than shutting on nothing.
            setSearchOpen(false);
            onJump(hitPlace, seq);
          }}
        />
      )}

      {/* The row-action sheet a tap opens instead of the hover bar. Same
          verbs, same guards, same handlers — each one closes the sheet
          first, then does what the hover bar's button would have done. */}
      {/* No title: the verbs are the whole sheet, and a tap outside or Escape
          closes it. */}
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
                  v.run({ onEdit, onDelete, onLookAt, onPhotograph, onStar, onRemove }, menuRow);
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* The scroller and the pill that floats over it share a wrapper, so
          the pill can be positioned against the feed's own bottom edge. It
          used to sit after this block as an ordinary flex child, which cost
          the feed a whole layout row and pushed the scene up every time
          somebody scrolled away from the bottom. */}
      <div className="chat-feed-wrap">
      <div ref={scrollerRef} onScroll={onScroll} className="chat-feed">
       <div ref={innerRef} className="chat-feed-inner">
        {/* The board is nailed to the top of the street, not filed into it in
            the order it went up: a notice is a thing standing there, and it
            has to still be readable after fifty lines of scene. */}
        {notices}
        {withRuns.length === 0 ? (
          historyState === "loaded" ? (
            <EmptyState>Nothing has been said here yet.</EmptyState>
          ) : (
            <FeedSkeleton />
          )
        ) : (
          <ul className="list-none p-0">
            <BacklogEdge
              loading={backlog.loading}
              exhausted={backlog.exhausted}
              floored={backlog.floored}
            />
            {withRuns.map(({ row, realName, startsRun, mine, system, canLook, canPhoto, canRemove, canStar, newLine }) => {
              const key = row.clientId ?? row.seq;
              if (system) {
                return (
                  <Fragment key={key}>
                    {newLine && <NewLine />}
                    <SystemRow row={row} />
                  </Fragment>
                );
              }
              const editing = Boolean(row.seq) && row.seq === editingSeq;
              return (
                <Fragment key={editing ? `${row.seq}:edit` : key}>
                  {newLine && <NewLine />}
                  <FeedRow
                    // Keyed by the CLIENT id where there is one, which the
                    // confirmed row carries now too (feedStore.js#applyRow):
                    // the optimistic row and the row that confirms it are then
                    // one React element, so the <li> and its <img> survive the
                    // swap instead of one unmounting as the other mounts.
                    row={row}
                    realName={realName}
                    startsRun={startsRun}
                    mine={mine}
                    canLook={canLook}
                    canPhoto={canPhoto}
                    canRemove={canRemove}
                    canStar={canStar}
                    editing={editing}
                    // A pending row is your own send, which has always just
                    // happened; anything past the floor arrived while you
                    // were watching. Everything else is backlog.
                    live={Boolean(row.pending) || Number(row.seq) > liveFloor}
                    onRetry={onRetry}
                    onEdit={onEdit}
                    onCancelEdit={onCancelEdit}
                    onSaveEdit={onSaveEdit}
                    onDelete={onDelete}
                    onLookAt={onLookAt}
                    onPhotograph={onPhotograph}
                    onStar={onStar}
                    onRemove={onRemove}
                    onOpenMenu={setMenuRow}
                  />
                </Fragment>
              );
            })}
          </ul>
        )}
       </div>
      </div>

      {/* Who is writing something. Inside the wrap so that on a phone it can
          sit OVER the last line of the scene rather than under it — a row of
          its own is a row the feed does not have there. On a desktop it is
          still a line between the scene and the box, holding its height
          whether or not anybody is writing, so the feed does not jump every
          time somebody starts and stops. */}
      <p className="chat-typing" aria-live="polite">
        {typing}
      </p>

      {!atBottom && (
        <button
          type="button"
          className="btn-quiet chat-pill"
          onClick={() => {
            atBottomRef.current = true;
            setAtBottom(true);
            scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
          }}
        >
          {newCount > 0 ? `${newCount} new` : "New messages"}
          <span aria-hidden="true"> ↓</span>
        </button>
      )}
      </div>

      {!readOnly && gm && place && !place.canSpeak && place.kind !== "dead" ? (
        <GmSystemComposer key={placeKey} placeKey={placeKey} placeName={place.name} />
      ) : null}

      {!readOnly && place && !(gm && !place.canSpeak) && (
        <div className="chat-composer">
          {place.canSpeak ? (
            <>
              <div className="field chat-composer-box" data-command={command ? "true" : undefined}>
                {/* COMMAND MODE reads as a strip across the top of the box —
                    what you are running, what it does, and a way out. It used
                    to be a floating accent-tinted pill above the textarea,
                    which read as a bubble stuck to the composer rather than
                    as a state the box was in. */}
                {command && (
                  <div className="chat-cmd-strip">
                    <span className="chat-cmd-strip-name mono">/{command.entry.name}</span>
                    {command.entry.description && (
                      <span className="chat-cmd-strip-hint">{command.entry.description}</span>
                    )}
                    <button
                      type="button"
                      className="chat-cmd-strip-out"
                      aria-label="Leave command mode"
                      onClick={() => exitCommand("")}
                    >
                      ✕
                    </button>
                  </div>
                )}
                {/* ONE row inside the box: what voice you are in, your hands,
                    the words, and the send. All four used to be separate boxes
                    standing in a line — a dropdown, a recess, and a solid
                    orange slab as tall as both — which is three objects to read
                    before you can type into one of them. */}
                <div className="chat-composer-row">
                  {/* Speak / Shout / OOC. Hidden when there is only Speak to
                      pick — a control with one option is decoration. Desktop
                      only: on a phone the same three sit under the + with the
                      rest of the composer's verbs.

                      The shared Select, never a bare <select>: it draws its own
                      popup rather than OS chrome that ignores the theme. It
                      already puts `.control` on its trigger, and inside this
                      container that is a frame around a frame, so the CSS takes
                      its surface and border off and leaves a label you press. */}
                  {!narrow && speechModes.length > 1 && (
                    <Select
                      className="chat-mode-select"
                      aria-label="How to talk"
                      value={speechMode ?? "speak"}
                      onChange={(e) => pickSpeechMode(e.target.value)}
                    >
                      {speechModes.map((m) => (
                        <option key={m.mode} value={m.mode}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                  )}
                  {composerTools}
                  <textarea
                    id="chat-composer"
                    ref={textareaRef}
                    aria-label={
                      concealed && alias ? `Say something as ${alias}` : `Say something in ${place.name}`
                    }
                    rows={1}
                    value={draft}
                    // Three words, and no place name. It read "Say something
                    // in {place}…", which wrapped to two lines on a phone — and
                    // a textarea cannot ellipsis a placeholder, so the second
                    // line was simply cut off. The place is named in the header
                    // directly above the scene anyway, so the box was repeating
                    // it. "Enter to send · Shift+Enter for a line" used to ride
                    // along on the end of this too: permanent chrome, at full
                    // size, for something anybody learns on their first message.
                    //
                    // The hood keeps its own line. That one is not a label for
                    // where you are, it is a warning about which name every row
                    // you send will wear. The aria-label above still says the
                    // place, where the words cost no pixels.
                    placeholder={
                      command
                        ? (textArgOf(command.entry)?.placeholder ?? "Press Enter to run it")
                        : concealed && alias
                          ? `Say something as ${alias}…`
                          : "Say something…"
                    }
                    onChange={onDraftChange}
                    onKeyDown={(e) => {
                      // The `/` list owns the keys while it is open, the same
                      // way the @ list does below — and it is checked first,
                      // because the two are never open at once and this one is
                      // the more recently opened when they compete.
                      if (slash && cmdMatches.length > 0) {
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          e.preventDefault();
                          const step = e.key === "ArrowDown" ? 1 : cmdMatches.length - 1;
                          setSlash((cur) => (cur ? { ...cur, active: (cur.active + step) % cmdMatches.length } : cur));
                          return;
                        }
                        if (e.key === "Enter" || e.key === "Tab") {
                          e.preventDefault();
                          pickCommand(cmdMatches[slash.active] ?? cmdMatches[0]);
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setSlash(null);
                          return;
                        }
                      }
                      // In command mode the box belongs to the command. Escape
                      // drops the chip; so does Backspace on an empty box, which
                      // is how Discord's composer lets go of one.
                      if (command) {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          exitCommand(`/${command.entry.name} `);
                          return;
                        }
                        if (e.key === "Backspace" && draft.length === 0) {
                          e.preventDefault();
                          exitCommand(`/${command.entry.name}`);
                          return;
                        }
                        if (!coarse && e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          runCurrent();
                          return;
                        }
                        return;
                      }
                      // The @ list owns the arrows and Enter while it is open —
                      // it is the thing the keystroke is aimed at.
                      if (mention && matches.length > 0) {
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          e.preventDefault();
                          const step = e.key === "ArrowDown" ? 1 : matches.length - 1;
                          setMention((m) => (m ? { ...m, active: (m.active + step) % matches.length } : m));
                          return;
                        }
                        if (e.key === "Enter" || e.key === "Tab") {
                          e.preventDefault();
                          pickMention(matches[mention.active] ?? matches[0]);
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setMention(null);
                          return;
                        }
                      }
                      // A phone keyboard's Enter is a newline, as it is in
                      // Discord's app; the button beside the box is the send
                      // there. On a keyboard Enter sends and Shift+Enter breaks
                      // the line.
                      if (coarse || e.key !== "Enter" || e.shiftKey) return;
                      e.preventDefault();
                      submit();
                    }}
                  />
                  {/* ONE send for both faces now. On a phone it is the 44px
                      accent glyph a thumb aims at; on a desktop the same glyph,
                      quiet, inside the box — it was a filled .btn stretched to
                      the full height of the box beside it, which made the
                      heaviest object on the page a control almost nobody
                      presses, since Enter sends. The verb (/shout says "Send",
                      most commands say "Run") rides in the label, which
                      IconButton puts in both the aria-label and the tooltip. */}
                  <IconButton
                    icon={SendIcon}
                    label={sendLabel}
                    className={narrow ? "icon-btn chat-send" : "icon-btn chat-composer-send"}
                    size={narrow ? "lg" : "sm"}
                    onClick={command ? runCurrent : submit}
                    disabled={
                      command
                        ? cmdPending || (Boolean(textArgOf(command.entry)) && !draft.trim())
                        : !draft.trim() || waitSeconds > 0
                    }
                  />
                </div>
                {mention && (
                  <MentionMenu
                    matches={matches}
                    active={mention.active}
                    onPick={pickMention}
                    onHover={(i) => setMention((cur) => (cur ? { ...cur, active: i } : cur))}
                  />
                )}
                {slash && (
                  <CommandMenu
                    matches={cmdMatches}
                    active={slash.active}
                    onPick={pickCommand}
                    onHover={(i) => setSlash((cur) => (cur ? { ...cur, active: i } : cur))}
                  />
                )}
                {/* The arguments a command still wants, as chips under the
                    box. One row at a time: the first unfilled one is the
                    question being asked, and drawing all of them at once would
                    be a form rather than a command line. */}
                {command && (
                  <CommandArgs
                    command={command}
                    people={people}
                    members={membersData?.members ?? []}
                    query={draft}
                    onPick={(name, value) =>
                      setCommand((cur) => (cur ? { ...cur, values: { ...cur.values, [name]: value } } : cur))
                    }
                  />
                )}
              </div>
              {/* Slowmode, said as a clock rather than as a refusal — and
                  said BEFORE it bites. It only appeared once the wait was
                  already running, so the first a player knew of a slowmode was
                  being stopped by one. The zone summary is the only place that
                  has one at all. */}
              {slowmodeMs > 0 && (
                <span
                  className="chat-countdown mono"
                  data-nudge={nudge ? "true" : undefined}
                  data-waiting={waitSeconds > 0 ? "true" : undefined}
                  aria-live="polite"
                >
                  {waitSeconds > 0 ? `${waitSeconds} s` : `${Math.round(slowmodeMs / 1000)} s`}
                </span>
              )}
              {/* The count, drawn only where a limit actually exists to run
                  into — the refusal used to be the first mention of one. A
                  keyboard hint used to sit here beside it, then inside the
                  box's placeholder; it is gone entirely now. */}
              {command && textArgOf(command.entry)?.maxLength && (
                <span
                  className="chat-composer-count mono"
                  data-over={draft.trim().length > textArgOf(command.entry).maxLength ? "true" : undefined}
                >
                  {draft.trim().length}/{textArgOf(command.entry).maxLength}
                </span>
              )}
              {/* The same readout for ordinary speech, which had none — a
                  player typed a goods list, the box let them, and the refusal
                  was the first they heard of a limit. Silent until they are
                  near it, then the count, then what it will actually do. */}
              {!command && sayCount && (
                <span className="chat-composer-count mono" data-over={sayCount.over ? "true" : undefined}>
                  {sayCount.label}
                </span>
              )}
            </>
          ) : place.vantage ? (
            // A street you walked out of earlier this turn and are still
            // watching (db/lib/vantages.js). Plain and factual — the reason
            // you cannot speak is simply that you are not there.
            <p className="chat-quiet italic">You aren&apos;t in this location.</p>
          ) : place.kind === "net" ? (
            // A radio you can only listen on — the Cerberon bracelet. Not
            // "you're a ghost": the set works, it just has no transmitter.
            <p className="chat-quiet italic">This radio only receives.</p>
          ) : place.kind === "loc" ? (
            // The street. Not "you can only watch here" — that reads like a
            // refusal, and this is a signpost: the scene is one door away, and
            // the line says which doors.
            <p className="chat-quiet italic">
              Go into a room, the zone summary channel, or a conversation to speak.
            </p>
          ) : place.kind === "dead" && gm ? (
            // A living GM reading the dead. They are not a ghost, so don't
            // call them one; they answer the dead through /dm or the desk.
            <p className="chat-quiet italic">GMs read Deadchat and don&apos;t speak in it.</p>
          ) : (
            // Everywhere else a character may read but not speak. The street
            // is not here any more — it has its own line above — so what is
            // left is somebody with no voice at all.
            <p className="chat-quiet">You&apos;re a ghost. You can&apos;t speak.</p>
          )}
          {!place.canSpeak && composerTools}
        </div>
      )}

      {/* What a command answered. A server string a player reads, so it is
          rendered rather than printed — several of them carry a `**` because
          the same sentence goes out to Discord too. */}
      {cmdLine && (
        <div className="chat-quiet-line">
          <ChatMarkdown content={cmdLine} />
        </div>
      )}
      <FormError>{error ?? cmdError}</FormError>

      {photo && <PhotoReadout state={photo} onClose={() => setPhoto(null)} />}
      {look && <LookReadout state={look} onClose={() => setLook(null)} />}
    </div>
  );
}

// A GM in GM view posts a system line into whatever place they can see —
// the web twin of Discord's /gm command. Deliberately minimal: no character
// picker, hood, autocorrect, slash commands, reactions, slowmode or
// pending queue. The row comes back over the SSE hub like any other, so
// the composer just clears on success.
function GmSystemComposer({ placeKey, placeName }) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);
  useComposerAutosize(textareaRef, draft);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await gmSystemPost({ placeKey, content: text });
      if (result?.ok) setDraft("");
      else setError(result?.error ?? "Couldn't send that.");
    } catch (err) {
      setError(err?.message ?? "Couldn't send that.");
    } finally {
      setPending(false);
    }
  }, [draft, placeKey, pending]);

  return (
    <div className="chat-composer">
      <div className="field chat-composer-box">
        <div className="chat-composer-row">
          <textarea
            ref={textareaRef}
            aria-label={placeName ? `Post as Bascinet in ${placeName}` : "Post as Bascinet"}
            rows={1}
            value={draft}
            placeholder={placeName ? `Post as Bascinet in ${placeName}…` : "Post as Bascinet…"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            disabled={pending}
          />
          {/* `icon`, not a child. IconButton renders `<Icon />` from the prop
              and ignores children, so passing <SendIcon /> between the tags
              left Icon undefined and threw "Element type is invalid" the
              moment a GM opened a place they cannot speak in. */}
          <IconButton
            icon={SendIcon}
            label="Send"
            className="icon-btn chat-composer-send"
            onClick={() => void submit()}
            disabled={pending || !draft.trim()}
          />
        </div>
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
