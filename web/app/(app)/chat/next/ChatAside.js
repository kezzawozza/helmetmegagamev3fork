"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { bandOf } from "@lifeweb/db/lib/mood";
import { obolsOf } from "@/lib/purse";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import FormError from "@/app/components/FormError";
import HereList from "@/app/components/HereList";
import useActionRunner from "@/app/components/useActionRunner";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import MoveDialog from "../MoveDialog";
import PartyRack from "../PartyRack";
import PlaceCard from "../PlaceCard";
import RoomPanel from "../RoomPanel";
import StatusStrip from "../StatusStrip";
import Things from "../ThingsDrawer";
import DesiresBlock from "../DesiresBlock";
import TravelNodes from "../TravelNodes";
import TurnCard from "../TurnCard";
import { usePlaceActions } from "../PlacePanel";
import { waitingOnYou, answerWaiting } from "../actions";
import useVisiblePoll from "../useVisiblePoll";
import useMyMove from "../useMyMove";

// THE RIGHT COLUMN, rebuilt (docs/systemdocs/CHAT-REBUILD.md phase 5).
//
// The WIRING below is ../ChatAside.js's, deliberately unchanged — the polls,
// the one usePlaceActions bag that owns every dialog, the fixture filter, the
// Move dialog's onDone chain. Those are load-bearing and already right; a
// rewrite of them would only be a chance to lose one.
//
// What is rebuilt is the SHAPE. The old column had nine sections and four
// headings: the place card, the room, travel and the party arrived as bare
// bodies with nothing naming them, so a reader scrolling the column met three
// unlabelled boxes in a row. Every framed section here wears a girder head
// (chat-vocabulary.md §4), and the two that carry their own fold heading —
// Things and Desires — keep it rather than being given a second one.
//
// The children are MOUNTED, not rewritten. PlaceCard carries fixtures and the
// Depot/Factory/Research doors, TravelNodes the crossing confirm, PartyRack
// the escort offers; they are deep game surfaces, and the plan's named risk is
// a rewrite losing things quietly. They are restyled from chat-next.css.
// A duplicate of ../ChatAside.js's, on purpose and briefly: importing it from
// there would make this file depend on the one the cutover deletes. Same key,
// same reason — HereList seeds rows into useState, so a new server list has to
// remount it rather than leave the poll answering for a street already left.
export function hereKey(people) {
  const named = (people?.named ?? []).map((person) => person.characterId).join(",");
  return `here:${named}|${(people?.concealed ?? []).length}`;
}

function WaitingList({ rows, onAnswered }) {
  const { run, pending, error } = useActionRunner();
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

// One framed section. The head is the only thing every block shares, so it is
// the only thing this takes — everything else is the child's own.
function Block({ head, children }) {
  return (
    <section className="block">
      <h3 className="bar">{head}</h3>
      <div className="body">{children}</div>
    </section>
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
  name,
  roleTitle,
  turn,
  moveCharacterId,
  move,
  sheet,
  carry,
  desires,
  things,
  depotHref = null,
  canSeeExtract = false,
  selected,
  travelPick = null,
  addPlace = null,
  onAddMember = null,
  onPlaceChanged = null,
  onOpenMap = null,
}) {
  const { affordances: live, openFixture, openConverse, say: placeSay, notice, error, pending, dialogs } =
    usePlaceActions(affordances, onPlaceChanged);
  const requestActions = useRequestActions();
  const openAction = requestActions?.open ?? null;
  const canResearch = requestActions?.pools?.canResearch ?? false;
  const researchHint = requestActions?.pools?.researchHint ?? null;

  // Travel / Who's here? / Secret rooms? / Examine are answered by this column
  // being on the page; they stay in db/lib/placeAffordances.js for Discord.
  const fixtures = live.filter(
    (entry) =>
      (entry.kind === "place" && entry.id === "noticeboard") || entry.kind === "gate" || entry.kind === "keyed",
  );

  const moveState = useMyMove({ turn, move, characterId: moveCharacterId });
  const [dialog, setDialog] = useState(null);
  const [waiting, setWaiting] = useState(initialWaiting);

  const refreshWaiting = useCallback(() => {
    waitingOnYou()
      .then((res) => {
        if (res?.ok) setWaiting(res.rows);
      })
      .catch(() => {
        // A reminder, not the record — a failed refresh loses nothing.
      });
  }, []);
  useVisiblePoll(refreshWaiting, 60_000);

  const onWaitingAnswered = useCallback(() => {
    refreshWaiting();
    moveState.refresh();
  }, [refreshWaiting, moveState]);

  const moodBand = bandOf(sheet?.mood ?? 0);
  const obols = obolsOf(sheet);
  const resources = sheet?.resources ?? 0;
  const worn = (sheet?.tags ?? []).filter((ct) => ct.tag?.category === "Status" || ct.tag?.category === "Health");
  const hereCount = (people?.named?.length ?? 0) + (people?.concealed?.length ?? 0);

  return (
    <div className="chat-aside-stack">
      <h2 className="bar">You</h2>

      {/* PLATE over WELL (chat-vocabulary.md §1): the one thing in this column
          that is what you ARE rather than what is true of the moment, so it is
          the one thing that gets the sprite frame instead of a block. */}
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
          {/* The sheet's own load bar and chips, not a second copy of either.
              numbers={false} — Resources and Carrying are already said above. */}
          <StatusStrip
            resources={resources}
            carry={carry}
            tags={worn}
            currentTurn={moveState.turn?.number ?? null}
            meter
            numbers={false}
          />
        </div>
      </div>

      <Block head="Turn">
        <TurnCard
          turn={moveState.turn}
          move={moveState.move}
          onFile={() => setDialog("move")}
          onEdit={() => setDialog("move")}
        />
      </Block>

      <Block head={`Here · ${hereCount}`}>
        {/* Keyed on the SERVER's list, so walking out remounts it rather than
            leaving the poll's answer for the street you have left. */}
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
      </Block>

      <Block head={`Waiting on you · ${waiting.length}`}>
        <WaitingList rows={waiting} onAnswered={onWaitingAnswered} />
      </Block>

      <Block head={place?.name ?? "Place"}>
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
          showTitle={false}
        />
        {/* A server string, RENDERED not printed — some carry `-#`/`**`,
            since the same sentence also goes out to Discord. */}
        {notice && (
          <div className="chat-quiet-line">
            <ChatMarkdown content={notice} />
          </div>
        )}
        <FormError>{error}</FormError>
      </Block>

      {/* BELOW the place card on purpose (MAP.md §3a): it fetches its party on
          mount, so above the card the Location's prose would jump every visit.
          Unheaded because it draws its own heading and hides itself entirely
          when there is nobody to bring — a "Party" girder over nothing would
          be a permanent empty box for most players. */}
      <PartyRack />

      {selected?.kind === "room" && (
        <Block head={selected?.name ?? "Room"}>
          <RoomPanel selected={selected} affordances={live} onFixture={openFixture} pending={pending} />
        </Block>
      )}

      <Block head="Travel">
        <TravelNodes onDone={placeSay} pick={travelPick} showTitle={false} />
      </Block>

      {/* Both carry their own fold heading; they are not given a second one. */}
      <Things groups={things} />
      <DesiresBlock view={desires} />

      <div className="chat-buttons">
        <Link className="btn-secondary" href="/character">
          Sheet ›
        </Link>
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

      {/* Outside every block on purpose: a dialog opened from one must not
          unmount because the reader scrolled past another. */}
      {dialogs}
    </div>
  );
}
