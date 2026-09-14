"use client";

import { memo } from "react";
import IconButton from "@/app/components/IconButton";
import HoverCard from "@/app/components/HoverCard";
import { BellIcon, BellOffIcon, BellRingIcon, CheckIcon, SendIcon } from "@/app/components/icons";
import { isUnread } from "./seenStore";
import { useFolded } from "./sectionFold";

// The left column of Chat: everywhere this character may read.
//   MESSAGES the DM pseudo-place · SUMMARY the zone's channel · RADIO the
//   frequencies carried · HERE the Location stood in · ROOMS public then
//   private · CONVERSATIONS private threads.
// On a phone (under 720px) the SAME column is the ≡ drawer over the scene
// (Chat.js), with a foot for the app's own links since the bottom bar is
// gone there.

// One character each — the column is 15rem wide and a label is what people read.
function glyph(place) {
  if (place.kind === "loc") return "▸";
  if (place.kind === "conv") return "»";
  if (place.kind === "zone") return "▤";
  if (place.kind === "net") return "∿"; // carried in your pack (db/lib/specialChannels.js)
  if (place.kind === "faction") return "⚑"; // pseudo-place, opens a roster (./FactionPanel.js)
  if (place.kind === "dm") return "✉"; // pseudo-place, drawn by ./DmPane.js
  return place.roomKind === "PRIVATE" ? "▪" : "";
}

// A row with a description shows it via HoverCard (the column scrolls, so an
// in-tree tooltip would clip); `pinnable={false}` since the row is already a
// button. A row with nothing to say stays a bare button, no portal mounted.
const PlaceRow = memo(function PlaceRow({ place, active, unread, onSelect }) {
  const button = (
    <button
      type="button"
      className="chat-place"
      data-active={active ? "true" : "false"}
      data-unread={unread ? "true" : undefined}
      onClick={() => onSelect(place.placeKey)}
    >
      <span className="chat-glyph" aria-hidden="true">
        {glyph(place)}
      </span>
      <span className="chat-place-name">{place.name}</span>
      {unread && <span className="chat-dot" aria-label="Unread" />}
    </button>
  );
  const description = place.description?.trim();
  if (!description) return button;
  return (
    <HoverCard
      pinnable={false}
      className="chat-place-hover"
      panel={
        <>
          <span className="chat-tip-name">{place.name}</span>
          <span className="chat-tip-desc">{description}</span>
        </>
      }
    >
      {button}
    </HoverCard>
  );
});

// A section folds shut and stays shut across visits (./sectionFold.js). A
// fold NEVER hides an unread place — a column that silently withholds a waiting conversation is worse than a long one.
function Section({ title, places, selected, seen, newest, onSelect }) {
  const [folded, toggleFolded] = useFolded(title);
  if (places.length === 0) return null; // after the hook above, per rules-of-hooks
  const unreadOf = (place) =>
    place.placeKey !== selected && isUnread(seen, place.placeKey, newest(place));
  const shown = folded ? places.filter((place) => unreadOf(place)) : places;
  const hidden = places.length - shown.length;
  return (
    <div className="chat-section">
      <button
        type="button"
        className="chat-section-title chat-section-fold"
        aria-expanded={!folded}
        onClick={toggleFolded}
      >
        <span className="chat-fold-mark" aria-hidden="true">
          {folded ? "▸" : "▾"}
        </span>
        {title}
        {hidden > 0 && <span className="chat-fold-count mono">{hidden}</span>}
      </button>
      {shown.map((place) => (
        <PlaceRow
          key={place.placeKey}
          place={place}
          active={place.placeKey === selected}
          unread={unreadOf(place)}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export default function PlacesColumn({
  places,
  selected,
  seen,
  newest,
  onSelect,
  webOnly = false,
  chimeMuted = false,
  onToggleChime = null,
  // Null on a browser with no PushManager or no VAPID keys set (CHAT.md §5a).
  push = null,
  onMarkAllSeen = null,
  // Phone drawer's nav links or GM mode's zone picker; null on desktop.
  foot = null,
}) {
  const here = places.filter((p) => p.kind === "loc");
  const rooms = places.filter((p) => p.kind === "room");
  const conversations = places.filter((p) => p.kind === "conv");
  const summary = places.filter((p) => p.kind === "zone");
  const nets = places.filter((p) => p.kind === "net");
  const faction = places.filter((p) => p.kind === "faction");
  const messages = places.filter((p) => p.kind === "dm");

  return (
    <nav className="chat-places" aria-label="Places">
      {/* First: what the game said to YOU, where a turn result lands (CHAT.md §2b). */}
      <Section title="Messages" places={messages} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section title="Summary" places={summary} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section title="Radio" places={nets} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section title="Here" places={here} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section title="Rooms" places={rooms} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section
        title="Conversations"
        places={conversations}
        selected={selected}
        seen={seen}
        newest={newest}
        onSelect={onSelect}
      />
      <Section title="Faction" places={faction} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      {/* Foot: chime pref (useChatChimeMuted.js) and the webOnly reminder
          (CHAT.md §6). Tail: pinned to the bottom, never below the fold of a
          GM's every-room list. */}
      <div className="chat-places-tail">
      <div className="chat-places-foot">
        {onToggleChime && (
          <IconButton
            icon={chimeMuted ? BellOffIcon : BellIcon}
            label={chimeMuted ? "Mentions are silent" : "Mentions chime"}
            aria-pressed={!chimeMuted}
            onClick={() => onToggleChime(!chimeMuted)}
          />
        )}
        {push && (
          <IconButton
            icon={push.on ? BellRingIcon : SendIcon}
            label={push.on ? "Notifications on" : "Notify me"}
            aria-pressed={push.on}
            disabled={push.busy}
            onClick={push.onToggle}
          />
        )}
        {onMarkAllSeen && (
          /* Bare .icon-btn, not IconButton: no Tooltip here. aria-label is the accessible NAME, not visible copy. */
          <button type="button" className="icon-btn" aria-label="Mark all read" onClick={onMarkAllSeen}>
            <CheckIcon width="15" height="15" />
          </button>
        )}
        {webOnly && <span className="chip chat-webonly">Playing from the web</span>}
      </div>
      {foot}
      </div>
    </nav>
  );
}
