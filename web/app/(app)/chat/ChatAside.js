"use client";

import ChatMarkdown from "@/app/components/ChatMarkdown";
import FormError from "@/app/components/FormError";
import HereList from "@/app/components/HereList";
import PartyRack from "./PartyRack";
import PlaceCard from "./PlaceCard";
import RoomPanel from "./RoomPanel";
import TravelNodes from "./TravelNodes";
import YouPanel from "./YouPanel";
import { usePlaceActions } from "./PlacePanel";
import { useAsideTab } from "./asideTabStore";
import { useRequestActions } from "@/app/components/RequestActionsProvider";

// The right column, and — under 900px (useAsideFolded.js) — everything inside
// the ⋯ sheet, same sections and order either way. Tabbed rather than stacked
// because several sections (place card, travel grid, YOU) are unbounded height
// and two render nothing at all when empty, so a stack made the column jump
// around; one open tab at a time keeps the strip still. HERE is drawn at the
// top of PLACE instead of its own tab — a playtester found tabbing to see who
// you're standing with tedious — accepting that HERE can still push the place
// card below the fold; fixing that needs the person menu moved onto
// .chat-menu-portal first (globals.css) before a max-height scroller is safe.
// The affordance list and its dialogs are owned once by usePlaceActions, which
// is why `dialogs` hangs below the panel rather than inside whichever tab
// opened them.
// Exported because Chat.js keys the phone's avatar strip on it too — HereList
// seeds rows into useState, so both need remounting on a new server list.
export function hereKey(people) {
  const named = (people?.named ?? []).map((person) => person.characterId).join(",");
  return `here:${named}|${(people?.concealed ?? []).length}`;
}

export default function ChatAside({
  people,
  affordances,
  place,
  zone,
  placeLines,
  waiting,
  selfId,
  // YOU column's own three: open turn/Move, sheet facts, Desire slots.
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
  const { affordances: live, openFixture, openConverse, say, notice, error, pending, dialogs } =
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

  // ROOM appears only when a room is open.
  const tabs = [
    { id: "place", label: "Place" },
    selected?.kind === "room" && { id: "room", label: "Room" },
    { id: "travel", label: "Travel" },
    { id: "you", label: "You" },
  ].filter(Boolean);
  const [openTab, setOpenTab] = useAsideTab(
    tabs.map((tab) => tab.id),
    "place",
  );

  return (
    <div className="chat-aside-tabs">
      <div className="chat-tabstrip" role="tablist" aria-label="This place">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`chat-tab-${tab.id}`}
            aria-selected={openTab === tab.id}
            aria-controls={`chat-panel-${tab.id}`}
            className="chat-tab"
            data-open={openTab === tab.id ? "true" : undefined}
            onClick={() => setOpenTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* One scroller for whichever panel is open, so the column's height is
          the column's height whatever is in it. */}
      <div
        className="chat-aside-panel"
        role="tabpanel"
        id={`chat-panel-${openTab}`}
        aria-labelledby={`chat-tab-${openTab}`}
      >
        {openTab === "place" && (
          <>
            {/* People first, above the Location's prose. Keyed on the SERVER's
                own list so a move remounts the list rather than leaving the
                poll's answer for the street you've left. */}
            <HereList
              key={hereKey(people)}
              people={people}
              selfId={selfId}
              onConverse={openConverse}
              addPlace={addPlace}
              onAddMember={onAddMember}
              poll
            />
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
            {/* BELOW the place card on purpose (docs/systemdocs/MAP.md §3a):
                fetches its party on mount, so above the card the Location's
                prose would jump on every visit. */}
            <PartyRack />
          </>
        )}

        {openTab === "room" && (
          <RoomPanel
            selected={selected}
            affordances={live}
            onFixture={openFixture}
            pending={pending}
          />
        )}

        {openTab === "travel" && <TravelNodes onDone={say} pick={travelPick} />}

        {openTab === "you" && (
          <YouPanel
            initialWaiting={waiting}
            turn={turn}
            move={move}
            moveCharacterId={moveCharacterId}
            status={{ resources: sheet?.resources ?? 0, carry, tags: sheet?.tags ?? [] }}
            desires={desires}
            things={things}
          />
        )}
      </div>

      {/* Outside the panel on purpose: a dialog opened from one tab must not
          unmount because the reader pressed another. */}
      {dialogs}
    </div>
  );
}
