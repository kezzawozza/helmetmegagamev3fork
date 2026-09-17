"use client";

import { useCallback, useEffect, useState } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import EmptyState from "@/app/components/EmptyState";
import GmZoneRail from "@/app/components/GmZoneRail";
import DevPanelModal, { prefetchDevPanel } from "@/app/components/DevPanelModal";
import TagChip from "@/app/components/TagChip";
import PlaceCard from "./PlaceCard";
import GmSayBox from "./GmSayBox";
import { useAsideTab } from "./asideTabStore";
import { gmPlaceView } from "./actions";

// The GM's right column. SAME SHAPE as ChatAside on purpose (CHAT.md §8): same
// tab strip/classes, PlaceCard is the player's own component. A GM has no
// hands — everything here is a readout plus GmSayBox. Loads via one server
// action, not page.js, since re-rendering the server tree per click is what
// CHAT.md §1 says this page must not do.

// A room's contents, as chips — shared by Place and Room tabs. Real TagChips,
// same as the player's column; unlike the player's, nothing here is a button.
function Things({ things, resources }) {
  if (!things?.length && !resources) return <p className="chat-quiet-line">Empty.</p>;
  return (
    <div className="chip-row">
      {resources > 0 && <span className="chip mono">{resources} ⬢</span>}
      {things.map((thing) => (
        <TagChip key={thing.tagId} tag={thing.tag} quantity={thing.quantity} />
      ))}
    </div>
  );
}

// The player's HereList is not reused on purpose: its menu is request dialogs
// (heal, loot, bind) a GM has no body to do. A name opens the Dev Panel instead.
// Every row is real — a hood hides somebody from the room, not the host, so
// a hooded person reads as what the room sees with the name behind it in
// brackets: "a young man (Greeblus)". Same form the scene beside this column
// prints on a hooded line (Feed.js), and the one /archive has always used.
// It used to be the real name with "showing as a young man" on a second quiet
// line under it, which read as two people until you looked twice.
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
              <CharacterAvatar
                characterId={person.characterId}
                name={person.name}
                version={person.avatarVersion}
                online={person.online}
              />
              {person.presentedAs ? `${person.presentedAs} (${person.name})` : person.name}
              {person.online ? <span className="chat-quiet-line"> · online</span> : null}
            </span>
            {(person.roleTitle || person.factionName) && (
              <span className="chat-quiet-line">
                {[person.roleTitle, person.factionName].filter(Boolean).join(" · ")}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function GmAside({ selected, gmZones, onPlaceChanged }) {
  const placeKey = selected?.placeKey ?? null;
  // Answer is STAMPED with the place asked about, so a slow reply for a place
  // already clicked past renders for nobody rather than under the wrong name.
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

  // A zone summary or radio net has no Location, so gets neither Room nor Travel.
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

        {/* A zone summary: the zone and its Locations, not people or stash. */}
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
            {/* The player's own card, unchanged; `fixtures`/`onFixture` omitted since those buttons need a body standing there. */}
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

        {openTab === "gm" && <GmSayBox selected={selected} onSaid={onPlaceChanged} />}
      </div>

      {/* Bottom-pinned by .chat-aside-tabs > .desk-inspector-zones. */}
      {gmZones && <GmZoneRail zones={gmZones.selectable} selectedIds={gmZones.selectedIds} />}

      {open && <DevPanelModal characterId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
