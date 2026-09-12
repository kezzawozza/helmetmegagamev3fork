"use client";

import { useCallback, useEffect, useState } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import EmptyState from "@/app/components/EmptyState";
import GmZoneRail from "@/app/components/GmZoneRail";
import DevPanelModal, { prefetchDevPanel } from "@/app/components/DevPanelModal";
import PlaceCard from "./PlaceCard";
import GmSayBox from "./GmSayBox";
import { useAsideTab } from "./asideTabStore";
import { gmPlaceView } from "./actions";

// THE GM's RIGHT COLUMN.
//
// A GM used to get two controls here — a Noticeboard button and the zone rail
// — because page.js builds the player's whole `aside` off viewer.character and
// GM mode is the absence of one. So the person reading every scene in the game
// had the least on the page: no idea who was standing in the room they were
// reading, what was stashed in it, or which way out was shut.
//
// It is the SAME SHAPE as ChatAside, deliberately: the same tab strip, the same
// .chat-aside-tabs / .chat-tabstrip / .chat-aside-panel, the same remembered
// tab. CHAT.md §8 set that posture for the desk's Scene tab — a GM reading a
// scene should be reading the player's page, not a GM-flavoured copy of it —
// and the column follows it. PlaceCard is literally the player's component.
//
// What it is NOT is a second copy of the player's column with the buttons
// greyed out. A GM has no hands: nothing here drops, takes, transfers or
// travels. Everything is a readout, plus the one thing a GM does to a place,
// which is say something into it.
//
// The data comes from one server action rather than from page.js. A player
// stands in one place and the page re-renders when they move; a GM changes
// place by clicking, and re-rendering the server tree on every click is the
// exact thing CHAT.md §1 says this page does not do.

// A room's contents, as chips. Shared by the Place tab's room list and the
// Room tab, so a stash reads the same either way.
function Things({ things, resources }) {
  if (!things?.length && !resources) return <p className="chat-quiet-line">Empty.</p>;
  return (
    <div className="chip-row">
      {resources > 0 && <span className="chip mono">{resources} ⬢</span>}
      {things.map((thing) => (
        <span key={thing.id} className="chip" title={thing.name}>
          {thing.name}
          {thing.quantity > 1 ? ` ×${thing.quantity}` : ""}
        </span>
      ))}
    </div>
  );
}

// WHO IS ACTUALLY STANDING THERE.
//
// The player's HereList is not reused, and that is on purpose rather than for
// want of trying: it polls off the reader's own Location, and its menu is the
// sheet's request dialogs — heal, loot, bind — none of which a GM has a body
// to do. What a GM wants from a name is the Dev Panel, so that is what a name
// is: DevPanelModal is already built to open over any desk without leaving it.
//
// Every row is real. A hood hides somebody from the room, not from the host,
// so the name is the name and `presentedAs` says what the room sees instead —
// which is the one thing the player's own list can never tell a GM.
function GmHereList({ people, onOpen }) {
  if (!people?.length) return <EmptyState>Nobody is standing here.</EmptyState>;
  return (
    <div className="chat-here">
      <p className="chat-section-title">Here · {people.length}</p>
      {people.map((person) => (
        <div key={person.characterId} className="chat-person-row">
          <button
            type="button"
            className="chat-person"
            onPointerDown={() => prefetchDevPanel(person.characterId)}
            onClick={() => onOpen(person.characterId)}
          >
            <span className="chat-person-name">
              <CharacterAvatar characterId={person.characterId} name={person.name} version={person.avatarVersion} />
              {person.name}
            </span>
            {(person.roleTitle || person.factionName) && (
              <span className="chat-quiet-line">
                {[person.roleTitle, person.factionName].filter(Boolean).join(" · ")}
              </span>
            )}
            {person.presentedAs && <span className="chat-quiet-line">showing as {person.presentedAs}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function GmAside({ selected, gmZones, onPlaceChanged }) {
  const placeKey = selected?.placeKey ?? null;
  // The answer is STAMPED with the place it was asked about, the way
  // RoomPanel's stash read is: a slow reply for a place the GM has already
  // clicked past is rendered for nobody rather than under the wrong name.
  const [view, setView] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    if (!placeKey) return undefined;
    let cancelled = false;
    gmPlaceView(placeKey)
      .then((res) => {
        if (!cancelled) setView({ placeKey, ...res });
      })
      .catch(() => {
        if (!cancelled) setView({ placeKey, ok: false, error: "Couldn't see in there." });
      });
    return () => {
      cancelled = true;
    };
  }, [placeKey]);

  useEffect(() => load(), [load]);

  const fresh = view?.placeKey === placeKey ? view : null;
  const kind = fresh?.ok ? fresh.kind : null;

  // The tabs this place actually has. A room adds its own, the way the
  // player's column does; a zone summary and a radio net have no Location
  // under them, so they get neither Room nor Travel rather than two panels
  // that would have nothing to draw.
  const placed = kind === "loc" || kind === "room" || kind === "conv";
  const tabs = [
    (placed || kind === "zone") && { id: "place", label: "Place" },
    kind === "room" && { id: "room", label: "Room" },
    placed && { id: "travel", label: "Travel" },
    { id: "gm", label: "GM" },
  ].filter(Boolean);
  const [openTab, setOpenTab] = useAsideTab(
    tabs.map((tab) => tab.id),
    placed || kind === "zone" ? "place" : "gm",
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

      <div
        className="chat-aside-panel"
        role="tabpanel"
        id={`chat-panel-${openTab}`}
        aria-labelledby={`chat-tab-${openTab}`}
      >
        {fresh && !fresh.ok && <EmptyState>{fresh.error}</EmptyState>}

        {/* A zone summary is not somewhere anybody stands, so there is nobody
            here and nothing stashed. What it IS is the zone and the Locations
            under it — which is the one readout that tells a GM what the
            channel they are reading actually covers. */}
        {openTab === "place" && fresh?.ok && kind === "zone" && (
          <>
            <div className="chat-card">
              <p className="chat-section-title">{fresh.zone.name}</p>
              <div className="chat-card-text">
                <p>{fresh.zone.description || "Nothing is written about this part of the world."}</p>
              </div>
            </div>
            <div className="chat-card">
              <p className="chat-section-title">Locations · {fresh.locations.length}</p>
              <div className="chip-row">
                {fresh.locations.map((location) => (
                  <span key={location.id} className="chip">
                    {location.name}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {openTab === "place" && fresh?.ok && placed && (
          <>
            <GmHereList people={fresh.people} onOpen={setOpen} />
            {/* The player's own card, unchanged. `fixtures` is empty and
                `onFixture` absent: the Location's buttons are things you do
                standing there, and the one a GM can work — the board — is
                below, where it reads as a GM's copy rather than a player's. */}
            <PlaceCard place={fresh.place} zone={fresh.zone} lines={fresh.lines} />

            {fresh.members && (
              <div className="chat-card">
                <p className="chat-section-title">In this conversation · {fresh.members.length}</p>
                <div className="chip-row">
                  {fresh.members.map((member) => (
                    <span key={member.characterId} className="chip">
                      {member.name}
                      {member.presentedAs ? ` (${member.presentedAs})` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {fresh.structures.length > 0 && (
              <div className="chat-card">
                <p className="chat-section-title">Standing here</p>
                {fresh.structures.map((structure) => (
                  <p key={structure.id} className="chat-quiet-line">
                    {structure.name} — {structure.status === "COMPLETE" ? "finished" : structure.status === "RUINED" ? "ruined" : `${structure.turnsDone}/${structure.turnsNeeded} built`}
                  </p>
                ))}
              </div>
            )}

            {fresh.rooms.length > 0 && (
              <div className="chat-room">
                <p className="chat-section-title">Rooms · {fresh.rooms.length}</p>
                {fresh.rooms.map((room) => (
                  <div key={room.id} className="chat-card-text">
                    <p>
                      {room.name}
                      {room.private ? " ▪" : ""}
                    </p>
                    {room.keys.length > 0 && (
                      <p className="chat-quiet-line">opened by {room.keys.join(", ")}</p>
                    )}
                    <Things things={room.things} resources={room.resources} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {openTab === "room" && fresh?.ok && fresh.openRoom && (
          <div className="chat-room">
            <p className="chat-section-title">{fresh.openRoom.name}</p>
            {fresh.openRoom.keys.length > 0 && (
              <p className="chat-quiet-line">opened by {fresh.openRoom.keys.join(", ")}</p>
            )}
            <Things things={fresh.openRoom.things} resources={fresh.openRoom.resources} />
            {fresh.openRoom.fixtures.length > 0 && (
              <p className="chat-quiet-line">
                On the wall: {fresh.openRoom.fixtures.map((f) => f.label).join(", ")}
              </p>
            )}
          </div>
        )}

        {openTab === "travel" && fresh?.ok && (
          <div className="chat-travel">
            <p className="chat-section-title">Ways out · {fresh.ways.length}</p>
            {fresh.ways.length === 0 ? (
              <EmptyState>Nowhere from here.</EmptyState>
            ) : (
              fresh.ways.map((way) => (
                <p key={way.linkId} className="chat-card-text">
                  {way.farName}
                  <span className="chat-quiet-line">
                    {way.modular ? (way.isOpen ? " · open" : " · shut") : ""}
                    {way.keyed ? (way.held ? " · keyed, held open" : " · keyed") : ""}
                  </span>
                </p>
              ))
            )}
          </div>
        )}

        {openTab === "gm" && (
          <>
            {kind === "net" && <EmptyState>A frequency is not a place. Nobody stands on one.</EmptyState>}
            <GmSayBox selected={selected} onSaid={onPlaceChanged} />
          </>
        )}
      </div>

      {/* Bottom-pinned by .chat-aside-tabs > .desk-inspector-zones, the same
          rule that held it when it was this column's only tenant. */}
      {gmZones && <GmZoneRail zones={gmZones.selectable} selectedIds={gmZones.selectedIds} />}

      {open && <DevPanelModal characterId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
