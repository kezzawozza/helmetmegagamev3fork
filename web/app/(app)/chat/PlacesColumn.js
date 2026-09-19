"use client";

import { memo, useMemo, useState } from "react";
import IconButton from "@/app/components/IconButton";
import HoverCard from "@/app/components/HoverCard";
import { BellRingIcon, CheckIcon, ChevronDownIcon, MailIcon, SendIcon } from "@/app/components/icons";
import { isUnread } from "./seenStore";

// The left column of Chat: everywhere this character may read, in the
// mockup's own shape (docs/design/mockups/chat/index.html).
//
// The top of the column belongs to no zone — MAIL the Bascinet conversation
// and Deadchat, one section, and RADIO the frequencies carried. Everything
// under that is grouped BY ZONE, the way
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
// A zone group and a section inside it can both fold shut — the whole of
// Town, or just its Locations. This is session-only state (a plain
// useState below), not persisted the way the old, deleted `sectionFold.js`
// used to: a reload opens everything again. The bug that folding used to
// trigger (`.bar`'s free space swallowed by a flex-grow shorthand once the
// column stopped overflowing) is fixed at the CSS root now — `.bar` pins
// `flex: 0 0 auto` longhand (chat.css) — so folding no longer breaks the
// column underneath it.
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
const PlaceRow = memo(function PlaceRow({ place, active, unread, count = 0, onSelect }) {
  const button = (
    <button
      type="button"
      className="place"
      data-active={active ? "true" : "false"}
      data-unread={unread ? "true" : undefined}
      data-notified={count > 0 ? "true" : undefined}
      data-vantage={place.vantage ? "true" : undefined}
      onClick={() => onSelect(place.placeKey)}
    >
      {glyph(place) && (
        <span className="mail" aria-hidden="true">
          {glyph(place)}
        </span>
      )}
      <span className="nm">{place.name}</span>
      {/* Discord's two levels (REDESIGN.md §6). UNREAD is the name brightening
          and nothing else — it used to be a dot, which is a second mark saying
          what the weight already says. A NUMBER only for a notified place: your
          name, your Bascinet mail, a DM. */}
      {count > 0 && (
        <span className="unread mono" aria-label={`${count} for you`}>
          {count}
        </span>
      )}
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

// The mockup's `.sect` heading, now a fold control. `sectionKey` is unique
// across the whole column (zone id + title, since "Summary"/"Here"/etc.
// repeat per zone) — `collapsed`/`onToggle` are the parent's shared Set, so
// one piece of state covers every section rather than one useState each.
// Empty sections still draw nothing, fold or not.
function Section({ title, places, selected, seen, notified, newest, onSelect, sectionKey, collapsed, onToggle }) {
  if (places.length === 0) return null;
  const open = !collapsed.has(sectionKey);
  const unreadOf = (place) =>
    place.placeKey !== selected && isUnread(seen, place.placeKey, newest(place));
  const countOf = (place) => notified?.get(place.placeKey) ?? 0;
  return (
    <div className="chat-section">
      <button type="button" className="sect chat-fold" aria-expanded={open} onClick={() => onToggle(sectionKey)}>
        <ChevronDownIcon data-open={open ? "true" : undefined} />
        {title}
      </button>
      {open &&
        places.map((place) => (
          <PlaceRow
            key={place.placeKey}
            place={place}
            active={place.placeKey === selected}
            unread={unreadOf(place)}
            count={countOf(place)}
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
  // placeKey -> how many things here were addressed to YOU (./notifiedStore.js).
  // A Map, and possibly empty; never null in practice, defaulted for the desk's
  // embeds.
  notified = null,
  newest,
  onSelect,
  // A gamemaster who is also playing somebody: `{ mode, onChange }`, where
  // mode is "gm" or "player". Null for everybody else — a plain player has no
  // second seat, and a GM with no character is in the GM seat with nothing to
  // switch to (web/lib/feedAccess.js#loadFeedViewer).
  viewAs = null,
  // Null on a browser with no PushManager or no VAPID keys set (CHAT.md §5a).
  push = null,
  onMarkAllSeen = null,
  // Phone drawer's nav links or GM mode's zone picker; null on desktop.
  foot = null,
}) {
  // The zone-less places, pinned to the top: what the game said to YOU, where
  // a turn result lands (CHAT.md §2b), and the frequencies in your pack.
  // Neither is a room on the map, so neither belongs under a zone's divider.
  //
  // Mail is the mockup's own section: the Bascinet conversation THEN
  // Deadchat, one heading — not the two folds this used to be. Deadchat is
  // mail rather than a place in the same sense the Bascinet DM is: it is
  // somewhere you ended up, not somewhere on the map, and for a ghost it is
  // the only row in the whole column they can answer.
  const mail = places.filter((p) => p.kind === "dm");
  // Deadchat is its own section, "Other" — neither mail nor a place on the map.
  const other = places.filter((p) => p.kind === "dead");
  // Radio section: standing nets, plus the party chat (which is nowhere for the
  // same reason a net is — it travels with the leader, not a Location).
  const nets = places.filter((p) => p.kind === "net");
  const parties = places.filter((p) => p.kind === "party");
  const radio = [...nets, ...parties];

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

  // The one Location a living character stands in, against a GM's or a ghost's
  // list of every Location in the game. The mockup heads the first "Here" and the
  // rest "Locations" (docs/design/mockups/chat/index.html), and for a player that
  // is exactly the same list under the truer of the two words.
  const hereTitle = (list) => (list.length === 1 ? "Here" : "Locations");

  // Folded zone groups and sections, both in one Set keyed by string — a
  // group's key is its zone id alone, a section's is `${zoneId}:${title}`
  // (section titles repeat per zone, so the zone id disambiguates). Not
  // persisted; a reload opens everything again (see the header comment).
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <nav className="chat-places" aria-label="Places">
      {/* The column's own bar, the way the feed and the right column have one
          (REDESIGN.md §5, "One header strip"). The mockup draws it; the column
          used to open straight onto its first section heading, which left the
          three columns with two bars between them and a gap where the third
          should be. */}
      <p className="bar">Places</p>
      <Section title="Mail" places={mail} selected={selected} seen={seen} notified={notified} newest={newest} onSelect={onSelect} sectionKey="mail" collapsed={collapsed} onToggle={toggle} />
      <Section title="Radio" places={radio} selected={selected} seen={seen} notified={notified} newest={newest} onSelect={onSelect} sectionKey="radio" collapsed={collapsed} onToggle={toggle} />
      <Section title="Other" places={other} selected={selected} seen={seen} notified={notified} newest={newest} onSelect={onSelect} sectionKey="other" collapsed={collapsed} onToggle={toggle} />
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
        const groupKey = group.zoneId ?? "elsewhere-zone";
        const groupOpen = !collapsed.has(groupKey);
        return (
          <div className="chat-zone-group" key={groupKey}>
            {divided && group.zoneName && (
              <button
                type="button"
                className="zone-div chat-fold"
                aria-expanded={groupOpen}
                aria-label={group.zoneName}
                onClick={() => toggle(groupKey)}
              >
                <ChevronDownIcon data-open={groupOpen ? "true" : undefined} />
                {group.zoneName}
              </button>
            )}
            {groupOpen && (
              <>
                <Section
                  title="Summary"
                  places={summary}
                  selected={selected}
                  seen={seen}
                  notified={notified}
                  newest={newest}
                  onSelect={onSelect}
                  sectionKey={`${groupKey}:summary`}
                  collapsed={collapsed}
                  onToggle={toggle}
                />
                <Section
                  title={hereTitle(here)}
                  places={here}
                  selected={selected}
                  seen={seen}
                  notified={notified}
                  newest={newest}
                  onSelect={onSelect}
                  sectionKey={`${groupKey}:here`}
                  collapsed={collapsed}
                  onToggle={toggle}
                />
                <Section
                  title="Rooms"
                  places={rooms}
                  selected={selected}
                  seen={seen}
                  notified={notified}
                  newest={newest}
                  onSelect={onSelect}
                  sectionKey={`${groupKey}:rooms`}
                  collapsed={collapsed}
                  onToggle={toggle}
                />
                <Section
                  title="Conversations"
                  places={conversations}
                  selected={selected}
                  seen={seen}
                  notified={notified}
                  newest={newest}
                  onSelect={onSelect}
                  sectionKey={`${groupKey}:conversations`}
                  collapsed={collapsed}
                  onToggle={toggle}
                />
                {/* Everywhere you have been this turn and can still watch. It
                    empties itself when you leave the zone or the day turns. */}
                <Section
                  title="Elsewhere"
                  places={elsewhere}
                  selected={selected}
                  seen={seen}
                  notified={notified}
                  newest={newest}
                  onSelect={onSelect}
                  sectionKey={`${groupKey}:elsewhere`}
                  collapsed={collapsed}
                  onToggle={toggle}
                />
              </>
            )}
          </div>
        );
      })}
      {/* Foot: the seat switch, then push. Tail: pinned to the bottom, never
          below the fold of a GM's every-room list. */}
      <div className="chat-places-tail">
        {viewAs && (
          <div className="chat-view-as" role="group" aria-label="View as">
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
