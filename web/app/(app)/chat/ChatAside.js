"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { bandOf } from "@lifeweb/db/lib/mood";
import { obolsOf } from "@/lib/purse";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import FormError from "@/app/components/FormError";
import HereList from "@/app/components/HereList";
import useActionRunner from "@/app/components/useActionRunner";
import MoveDialog from "./MoveDialog";
import PartyRack from "./PartyRack";
import PlaceCard from "./PlaceCard";
import RoomPanel from "./RoomPanel";
import StatusStrip from "./StatusStrip";
import Things from "./ThingsDrawer";
import DesiresBlock from "./DesiresBlock";
import TravelNodes from "./TravelNodes";
import TurnCard from "./TurnCard";
import { usePlaceActions } from "./PlacePanel";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import { waitingOnYou, answerWaiting } from "./actions";
import useVisiblePoll from "./useVisiblePoll";
import useMyMove from "./useMyMove";

// The right column, stacked to the mockup's shape now
// (docs/design/mockups/chat/index.html): `.bar` You, the you-frame, then
// three `.block`s — Turn, Here, Waiting on you — in that order, because that
// is the order a player actually asks the questions ("what turn is it", "who
// else is here", "what's waiting on me"). No tabs any more: the five old tabs
// (Place/Room/Travel/You, and You's own Things/Desires) are folded below the
// four mockup blocks as plain, always-mounted sections — CHAT.md §7 lists
// exactly where each one landed. Under 720px (useAsideFolded.js) this same
// component is what the ⋯ sheet holds — one stack, one order, either way.
//
// The affordance list and its dialogs are owned once by usePlaceActions,
// which is why `dialogs` hangs below every block rather than inside whichever
// one opened them.
// Exported because Chat.js keys the phone's avatar strip on it too — HereList
// seeds rows into useState, so both need remounting on a new server list.
export function hereKey(people) {
  const named = (people?.named ?? []).map((person) => person.characterId).join(",");
  return `here:${named}|${(people?.concealed ?? []).length}`;
}

// Waiting on you: pending offers, a threat seat, a letter the bird has not
// left with, a lobby assignment. Accept and Decline call the SAME db/lib
// functions the DM's buttons call (db/lib/lessons.js, bind.js, confession.js,
// threatSpawn.js, lobby.js), so an answer given here and one given in Discord
// are one answer, and the second surface finds nothing left to answer.
function WaitingList({ rows, onAnswered }) {
  const { run, pending, error } = useActionRunner();
  // A row whose answer is a PICKER rather than a yes — the bird's Reply, so
  // far. It opens the sheet's own dialog in place instead of sending the
  // player somewhere to look for it.
  const openAction = useRequestActions()?.open ?? null;
  if (rows.length === 0) return <p className="chat-quiet-line">Nothing is waiting on you.</p>;
  return (
    <>
      {rows.map((row) => (
        <div key={row.key} className="chat-waiting-row">
          <p className="quote">{row.label}</p>
          <div className="chat-buttons">
            {row.accept !== false && (
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() => run(answerWaiting, { kind: row.kind, id: row.id, accept: true }, { onOk: onAnswered })}
              >
                Accept
              </button>
            )}
            {row.decline !== false && (
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() => run(answerWaiting, { kind: row.kind, id: row.id, accept: false }, { onOk: onAnswered })}
              >
                Decline
              </button>
            )}
            {row.mode && openAction && (
              <button type="button" className="btn" onClick={() => openAction(row.mode)}>
                Answer
              </button>
            )}
            {row.href && (
              <Link className="btn" href={row.href}>
                Open
              </Link>
            )}
          </div>
        </div>
      ))}
      <FormError>{error}</FormError>
    </>
  );
}

export default function ChatAside({
  people,
  affordances,
  place,
  zone,
  placeLines,
  waiting: initialWaiting,
  selfId,
  // The you-frame's own line and its kv rows.
  name,
  roleTitle,
  turn,
  moveCharacterId,
  move,
  sheet,
  carry,
  desires,
  things,
  // Decided server-side in page.js; the link's page and the dialog's action
  // each re-check their own gate.
  depotHref = null,
  canSeeExtract = false,
  selected,
  // `/travel <somewhere>` from the composer; the Go button still moves anybody.
  travelPick = null,
  // The open place, for HereList's "Add to …" menu.
  addPlace = null,
  onAddMember = null,
  onPlaceChanged = null,
  // Chat.js owns the map overlay, not this component, since it renders
  // ChatAside twice (desktop column and ⋯ sheet).
  onOpenMap = null,
}) {
  const { affordances: live, openFixture, openConverse, say: placeSay, notice, error, pending, dialogs } =
    usePlaceActions(affordances, onPlaceChanged);
  // Extract is the SHEET's dialog, mounted on this page (play/page.js) — no
  // second copy of it here.
  const requestActions = useRequestActions();
  const openAction = requestActions?.open ?? null;
  // Research (CRAFTING.md §2b): same canResearch/researchHint pool the sheet's
  // Research row reads (TagRail.js).
  const canResearch = requestActions?.pools?.canResearch ?? false;
  const researchHint = requestActions?.pools?.researchHint ?? null;

  // Travel/Who's here?/Secret rooms?/Examine filtered out: this column answers
  // those by being on the page. They stay in db/lib/placeAffordances.js for
  // the Discord anchor.
  const fixtures = live.filter(
    (entry) =>
      (entry.kind === "place" && entry.id === "noticeboard") ||
      entry.kind === "gate" ||
      entry.kind === "keyed",
  );

  // The Move half of the poll, shared with the sheet's own band (SheetTurn.js).
  const moveState = useMyMove({ turn, move, characterId: moveCharacterId });
  const [dialog, setDialog] = useState(null);
  const [waiting, setWaiting] = useState(initialWaiting);

  const refreshWaiting = useCallback(() => {
    // Just the offer list: useMyMove runs the Move's own minute poll, and
    // polling it from here too asked for the same row twice a minute.
    waitingOnYou()
      .then((res) => {
        if (res?.ok) setWaiting(res.rows);
      })
      .catch(() => {
        // The list is a reminder, not the record. A failed refresh loses
        // nothing a reload does not bring back.
      });
  }, []);
  // A minute is often enough for a notice board of this kind, and it costs
  // one small query.
  useVisiblePoll(refreshWaiting, 60_000);

  const onWaitingAnswered = useCallback(() => {
    refreshWaiting();
    moveState.refresh();
  }, [refreshWaiting, moveState]);

  const moodBand = bandOf(sheet?.mood ?? 0);
  const obols = obolsOf(sheet);
  const resources = sheet?.resources ?? 0;
  const worn = (sheet?.tags ?? []).filter((ct) => ct.tag?.category === "Status" || ct.tag?.category === "Health");

  return (
    <div className="chat-aside-stack">
      <h2 className="bar">You</h2>

      {/* The body, inside the sprite frame the mockup draws around it
          (docs/design/mockups/chat/index.html, `.you-frame`). THIS block and
          no other — it is what you are, and the turn, who's here and what's
          waiting on you are things that are true of the moment instead. */}
      <div className="you-frame">
        <div className="you-well">
          <p className="you-name">{name}</p>
          <p className="you-role">
            {roleTitle ?? "No role"} · {zone?.name ?? "Nowhere"}
          </p>
          <dl className="m-0">
            <div className="kv">
              <dt>Mood</dt>
              <dd>{moodBand?.label ?? "Fine"}</dd>
            </div>
            <div className="kv">
              <dt>Resources</dt>
              <dd className="mono">{resources} ⬢</dd>
            </div>
            <div className="kv">
              <dt>Purse</dt>
              <dd className="mono">{obols} ¢</dd>
            </div>
            {carry && (
              <div className="kv">
                <dt>Carrying</dt>
                <dd className="mono">
                  {Math.round(carry.weightUsed)}/{carry.weightCap} lb
                </dd>
              </div>
            )}
          </dl>
          {/* Reuses the sheet's own load bar and tag chips rather than a
              second copy of either (StatusStrip.js) — `numbers={false}`
              because Resources/Carrying are already said above, in words. */}
          <StatusStrip resources={resources} carry={carry} tags={worn} currentTurn={moveState.turn?.number ?? null} meter numbers={false} />
        </div>
      </div>

      <div className="block">
        <h3 className="bar">Turn</h3>
        <div className="body">
          <TurnCard
            turn={moveState.turn}
            move={moveState.move}
            onFile={() => setDialog("move")}
            onEdit={() => setDialog("move")}
          />
        </div>
      </div>

      <div className="block">
        <h3 className="bar">Here · {(people?.named?.length ?? 0) + (people?.concealed?.length ?? 0)}</h3>
        <div className="body">
          {/* Keyed on the SERVER's own list so a move remounts the list
              rather than leaving the poll's answer for the street you've
              left. Same rows, same per-person menu the sheet's Actions panel
              uses (HereList.js) — not rebuilt as bare chips, since the row IS
              the menu's anchor (avatar, the eye, Heal/Loot/Bind/…). */}
          <HereList
            key={hereKey(people)}
            people={people}
            selfId={selfId}
            onConverse={openConverse}
            addPlace={addPlace}
            onAddMember={onAddMember}
            poll
            showTitle={false}
          />
        </div>
      </div>

      <div className="block">
        <h3 className="bar">Waiting on you · {waiting.length}</h3>
        <div className="body">
          <WaitingList rows={waiting} onAnswered={onWaitingAnswered} />
        </div>
      </div>

      {dialog === "move" && (
        <MoveDialog
          turn={moveState.turn}
          characterId={moveState.characterId}
          existing={moveState.move?.editable ? moveState.move : null}
          onClose={() => setDialog(null)}
          onDone={(res) => {
            setDialog(null);
            onWaitingAnswered();
            placeSay?.(res);
          }}
        />
      )}

      {/* Everything below is a current game verb with no home in the
          mockup's four blocks — kept, not cut, per CHAT.md §7: the place
          card and its fixtures, the room (only while one is open), travel,
          the party you're bringing, and the two closed-by-default drawers
          this column already had. */}
      <div className="block">
        <div className="body">
          <PlaceCard
            place={place}
            zone={zone}
            lines={placeLines}
            fixtures={fixtures}
            onFixture={openFixture}
            onConverse={openConverse}
            depotHref={depotHref}
            onFactory={canSeeExtract && openAction ? () => openAction("extract") : null}
            onResearch={canResearch && openAction ? () => openAction("research") : null}
            researchHint={researchHint}
            onOpenMap={onOpenMap}
            pending={pending}
          />
          {/* A server string, rendered not printed — some carry `-#`/`**` since the same sentence goes out to Discord. */}
          {notice && (
            <div className="chat-quiet-line">
              <ChatMarkdown content={notice} />
            </div>
          )}
          <FormError>{error}</FormError>
        </div>
      </div>

      {/* BELOW the place card on purpose (docs/systemdocs/MAP.md §3a):
          fetches its party on mount, so above the card the Location's prose
          would jump on every visit. */}
      <PartyRack />

      {selected?.kind === "room" && (
        <div className="block">
          <div className="body">
            <RoomPanel selected={selected} affordances={live} onFixture={openFixture} pending={pending} />
          </div>
        </div>
      )}

      <div className="block">
        <div className="body">
          <TravelNodes onDone={placeSay} pick={travelPick} />
        </div>
      </div>

      <Things groups={things} />
      <DesiresBlock view={desires} />

      <div className="chat-buttons">
        <Link className="btn-secondary" href="/character">
          Sheet ›
        </Link>
      </div>

      {/* Outside every block on purpose: a dialog opened from one must not
          unmount because the reader scrolled past another. */}
      {dialogs}
    </div>
  );
}
