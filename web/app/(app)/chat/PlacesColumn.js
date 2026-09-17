"use client";

import { memo, useMemo } from "react";
import IconButton from "@/app/components/IconButton";
import HoverCard from "@/app/components/HoverCard";
import { BellIcon, BellOffIcon, BellRingIcon, CheckIcon, MailIcon, SendIcon } from "@/app/components/icons";
import { isUnread } from "./seenStore";
import { useFolded } from "./sectionFold";

// The left column of Chat: everywhere this character may read.
//
// The top of the column belongs to no zone — MESSAGES the DM pseudo-place,
// DEADCHAT the room the dead talk in, RADIO the frequencies carried, FACTION
// the roster pseudo-place. Everything under that is grouped BY ZONE, the way
// Discord groups channels by category,
// each group headed by a divider carrying the zone's name. Inside a group the
// sections read the same as they always have: SUMMARY the zone's channel ·
// HERE the Location stood in · ROOMS public then private · CONVERSATIONS
// private threads · ELSEWHERE the streets walked out of earlier this turn,
// still watched and all read-only (db/lib/vantages.js).
//
// The divider only draws when there are TWO OR MORE zones in the column. A
// living player stands in one zone and sees exactly what they always did; it
// is the GM and ghost seats, which watch every zone at once, that had a flat
// run of every Location in the game under one "Location" heading.
//
// On a phone (under 720px) the SAME column is the ≡ drawer over the scene
// (Chat.js), with a foot for the app's own links since the bottom bar is
// gone there.

// The one row with a mark: the Bascinet conversation, which is mail rather
// than a place. Every place row is its name alone — a glyph per kind was a
// column of small pictures nobody read, and the section headings already say
// what a row is.
function glyph(place) {
  return place.kind === "dm" ? <MailIcon width="14" height="14" /> : null;
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
      data-vantage={place.vantage ? "true" : undefined}
      onClick={() => onSelect(place.placeKey)}
    >
      {glyph(place) && (
        <span className="chat-glyph" aria-hidden="true">
          {glyph(place)}
        </span>
      )}
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
// `foldKey` scopes the remembered fold to one zone group: with the column
// split by zone, keying on the bare title would mean folding Rooms under Town
// also folded Rooms under every other zone. Ungrouped, it IS the title, so a
// player's existing folds carry over untouched.
function Section({ title, places, selected, seen, newest, onSelect, foldKey = null }) {
  const [folded, toggleFolded] = useFolded(foldKey ?? title);
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
  // A gamemaster who is also playing somebody: `{ mode, onChange }`, where
  // mode is "gm" or "player". Null for everybody else — a plain player has no
  // second seat, and a GM with no character is in the GM seat with nothing to
  // switch to (web/lib/feedAccess.js#loadFeedViewer).
  viewAs = null,
  chimeMuted = false,
  onToggleChime = null,
  // Null on a browser with no PushManager or no VAPID keys set (CHAT.md §5a).
  push = null,
  onMarkAllSeen = null,
  // Phone drawer's nav links or GM mode's zone picker; null on desktop.
  foot = null,
}) {
  // The zone-less places, pinned to the top: what the game said to YOU, where
  // a turn result lands (CHAT.md §2b), the frequencies in your pack, and the
  // faction roster. None of the three is a room on the map, so none of them
  // belongs under a zone's divider.
  const messages = places.filter((p) => p.kind === "dm");
  // Its own section rather than folded under Radio: a net is something you carry and Deadchat is
  // somewhere you ended up, and for a ghost it is the only row in the whole column they can answer.
  const deadchat = places.filter((p) => p.kind === "dead");
  // Radio section: standing nets, plus the party chat (which is nowhere for the
  // same reason a net is — it travels with the leader, not a Location).
  const nets = places.filter((p) => p.kind === "net");
  const parties = places.filter((p) => p.kind === "party");
  const radio = [...nets, ...parties];
  const faction = places.filter((p) => p.kind === "faction");

  // Everything else, bucketed by zone in the order the server sent it — which
  // already IS zone order (db/lib/feedAccess.js reads Zone.sortOrder). A place
  // with no zone that is not one of the three above falls into a trailing
  // group of its own, so a place kind added later can never go undrawn.
  const groups = useMemo(() => {
    const out = [];
    const byZone = new Map();
    const loose = [];
    for (const place of places) {
      if (
        place.kind === "dm" ||
        place.kind === "net" ||
        place.kind === "party" ||
        place.kind === "faction" ||
        place.kind === "dead"
      ) continue;
      if (!place.zoneId) {
        loose.push(place);
        continue;
      }
      let group = byZone.get(place.zoneId);
      if (!group) {
        group = { zoneId: place.zoneId, zoneName: place.zoneName ?? "", places: [] };
        byZone.set(place.zoneId, group);
        out.push(group);
      }
      group.places.push(place);
    }
    if (loose.length > 0) out.push({ zoneId: null, zoneName: null, places: loose });
    return out;
  }, [places]);

  // One zone means no divider: there is nothing to divide it from, and a
  // player's column stays exactly as tall as it was.
  const divided = groups.length > 1;

  return (
    <nav className="chat-places" aria-label="Places">
      <Section title="Messages" places={messages} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section title="Deadchat" places={deadchat} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section title="Radio" places={radio} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      <Section title="Faction" places={faction} selected={selected} seen={seen} newest={newest} onSelect={onSelect} />
      {groups.map((group) => {
        // Elsewhere is cut FIRST and the other three exclude it, so a fogged
        // street and its rooms are drawn once, together, under their own
        // heading — not scattered through Here and Rooms where they would read
        // as places you are standing in.
        const elsewhere = group.places.filter((p) => p.vantage);
        const summary = group.places.filter((p) => p.kind === "zone");
        const here = group.places.filter((p) => p.kind === "loc" && !p.vantage);
        const rooms = group.places.filter((p) => p.kind === "room" && !p.vantage);
        const conversations = group.places.filter((p) => p.kind === "conv" && !p.vantage);
        const scope = divided ? group.zoneId : null;
        const foldKey = (title) => (scope ? `${scope}:${title}` : null);
        return (
          <div className="chat-zone-group" key={group.zoneId ?? "elsewhere-zone"}>
            {divided && group.zoneName && (
              <div className="chat-zone-divider" role="separator" aria-label={group.zoneName}>
                <span>{group.zoneName}</span>
              </div>
            )}
            <Section
              title="Summary"
              foldKey={foldKey("Summary")}
              places={summary}
              selected={selected}
              seen={seen}
              newest={newest}
              onSelect={onSelect}
            />
            <Section
              title="Location"
              foldKey={foldKey("Here")}
              places={here}
              selected={selected}
              seen={seen}
              newest={newest}
              onSelect={onSelect}
            />
            <Section
              title="Rooms"
              foldKey={foldKey("Rooms")}
              places={rooms}
              selected={selected}
              seen={seen}
              newest={newest}
              onSelect={onSelect}
            />
            <Section
              title="Conversations"
              foldKey={foldKey("Conversations")}
              places={conversations}
              selected={selected}
              seen={seen}
              newest={newest}
              onSelect={onSelect}
            />
            {/* Everywhere you have been this turn and can still watch. It
                empties itself when you leave the zone or the day turns. */}
            <Section
              title="Elsewhere"
              foldKey={foldKey("Elsewhere")}
              places={elsewhere}
              selected={selected}
              seen={seen}
              newest={newest}
              onSelect={onSelect}
            />
          </div>
        );
      })}
      {/* Foot: the seat switch, then the chime pref (useChatChimeMuted.js).
          Tail: pinned to the bottom, never below the fold of a GM's
          every-room list. */}
      <div className="chat-places-tail">
        {viewAs && (
          <div className="chat-view-as">
            <span>View as</span>
            <div className="segmented">
              <button
                type="button"
                aria-pressed={viewAs.mode === "gm"}
                onClick={() => viewAs.onChange("gm")}
              >
                GM
              </button>
              <button
                type="button"
                aria-pressed={viewAs.mode === "player"}
                onClick={() => viewAs.onChange("player")}
              >
                Player
              </button>
            </div>
          </div>
        )}
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
      </div>
      {foot}
      </div>
    </nav>
  );
}
