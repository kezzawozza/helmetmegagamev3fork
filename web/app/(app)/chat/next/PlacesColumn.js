"use client";

import { memo, useMemo } from "react";
import IconButton from "@/app/components/IconButton";
import HoverCard from "@/app/components/HoverCard";
import { BellRingIcon, CheckIcon, ChevronDownIcon, MailIcon, SendIcon } from "@/app/components/icons";
import { isUnread } from "../seenStore";
import { useFolds } from "./foldStore";

// THE LEFT COLUMN: everywhere this character may read.
//
// The top belongs to no zone — MAIL (the Bascinet conversation, then Deadchat)
// and RADIO (the frequencies carried). Neither is a room on the map, so neither
// sits under a zone's divider. Everything below is grouped BY ZONE, the way
// Discord groups channels by category: SUMMARY the zone's own channel · HERE
// the Location stood in · ROOMS · CONVERSATIONS · ELSEWHERE the streets walked
// out of earlier this turn, watched and read-only (db/lib/vantages.js).
//
// Rebuilt from ../PlacesColumn.js. The behaviour is the same to the row; what
// changed is that the old one threaded `selected`, `seen`, `notified`, `newest`
// and `onSelect` through every <Section> and every row — five props restated at
// nine call sites, so adding a sixth meant editing all nine. The grouping does
// the reading once here and hands each section rows that already know what they
// are.

function Row({ place, onSelect }) {
  const button = (
    <button
      type="button"
      className="row-line"
      data-active={place.active ? "true" : undefined}
      data-unread={place.unread ? "true" : undefined}
      data-vantage={place.vantage ? "true" : undefined}
      onClick={() => onSelect(place.placeKey)}
    >
      {place.kind === "dm" && (
        <span className="row-glyph" aria-hidden="true">
          <MailIcon width="14" height="14" />
        </span>
      )}
      <span className="nm">{place.name}</span>
      {/* Discord's two levels. UNREAD is the name brightening and nothing else
          — it carried a dot once, which is a second mark saying what the weight
          already says. A NUMBER only where something was addressed to YOU. */}
      {place.count > 0 && (
        <span className="badge mono" aria-label={`${place.count} for you`}>
          {place.count}
        </span>
      )}
    </button>
  );
  const description = place.description?.trim();
  if (!description) return button;
  // The column scrolls, so an in-tree tooltip would clip — HoverCard portals.
  // `pinnable={false}`: the row underneath is already a button.
  return (
    <HoverCard
      pinnable={false}
      className="row-hover"
      panel={
        <>
          <span className="tip-name">{place.name}</span>
          <span className="tip-desc">{description}</span>
        </>
      }
    >
      {button}
    </HoverCard>
  );
}

const Section = memo(function Section({ title, places, foldKey, shut, onToggle, onSelect, heading = "sect" }) {
  if (places.length === 0) return null;
  const open = !shut;
  return (
    <div className="chat-section">
      <button type="button" className={`${heading} fold`} aria-expanded={open} onClick={() => onToggle(foldKey)}>
        <ChevronDownIcon data-open={open ? "true" : undefined} />
        {title}
      </button>
      {open && places.map((place) => <Row key={place.placeKey} place={place} onSelect={onSelect} />)}
    </div>
  );
});

export default function PlacesColumn({
  places,
  selected,
  seen,
  // placeKey -> how many things here were addressed to YOU (../notifiedStore.js).
  notified = null,
  newest,
  onSelect,
  // A GM who also plays somebody: `{ mode, onChange }`. Null for everybody
  // else — a plain player has no second seat.
  viewAs = null,
  // Null with no PushManager or no VAPID keys (CHAT.md §5a).
  push = null,
  onMarkAllSeen = null,
  // The phone drawer's nav links, or a GM's zone picker. Null on desktop.
  foot = null,
}) {
  const [collapsed, toggle] = useFolds();

  // Read every row's state ONCE, here, rather than per section per render.
  const decorate = (place) => ({
    ...place,
    active: place.placeKey === selected,
    // The place you are reading is never unread.
    unread: place.placeKey !== selected && isUnread(seen, place.placeKey, newest(place)),
    count: notified?.get(place.placeKey) ?? 0,
  });

  const { mail, radio, other, groups, liveKeys } = useMemo(() => {
    const rows = places.map(decorate);
    const of = (kind) => rows.filter((p) => p.kind === kind);

    const mailRows = of("dm");
    // Deadchat has a section of its own, "Other": it is neither mail nor a
    // place on the map, and for a ghost it is the one row they can answer.
    const otherRows = of("dead");
    // The party chat is nowhere for the same reason a net is: it travels with
    // the leader, not with a Location.
    const radioRows = [...of("net"), ...of("party")];

    // Server order IS zone order (db/lib/feedAccess.js reads Zone.sortOrder),
    // so this buckets and never sorts. A place with no zone that is none of the
    // four above falls into a trailing group, so a kind added later can never
    // go undrawn.
    const out = [];
    const byZone = new Map();
    const loose = [];
    for (const place of rows) {
      if (["dm", "dead", "net", "party"].includes(place.kind)) continue;
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

    // Every fold key this column can draw right now. foldStore prunes anything
    // stored that is not in here — a conversation that closed, a street walked
    // out of — so the remembered set cannot grow forever.
    const keys = new Set(["mail", "radio"]);
    for (const group of out) {
      const k = group.zoneId ?? "loose-zone";
      keys.add(k);
      for (const s of ["summary", "here", "rooms", "conversations", "elsewhere"]) keys.add(`${k}:${s}`);
    }

    return { mail: mailRows, radio: radioRows, other: otherRows, groups: out, liveKeys: keys };
    // `decorate` closes over selected/seen/notified/newest, all of which are in
    // the dep list; it is deliberately not a useCallback, since it is cheap and
    // hoisting it would only move the same dependencies somewhere less obvious.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, selected, seen, notified, newest]);

  // One zone means no divider: there is nothing to divide it from, and a
  // living player's column stays exactly as tall as it was.
  const divided = groups.length > 1;
  const onToggle = (key) => toggle(key, liveKeys);
  const shut = (key) => collapsed.has(key);

  return (
    <nav className="chat-places" aria-label="Places">
      <p className="bar">Places</p>

      <Section title="Mail" places={mail} foldKey="mail" shut={shut("mail")} onToggle={onToggle} onSelect={onSelect} />
      <Section title="Radio" places={radio} foldKey="radio" shut={shut("radio")} onToggle={onToggle} onSelect={onSelect} />
      <Section title="Other" places={other} foldKey="other" shut={shut("other")} onToggle={onToggle} onSelect={onSelect} />

      {groups.map((group) => {
        const key = group.zoneId ?? "loose-zone";
        // Elsewhere is cut FIRST and the other sections exclude it, so a fogged
        // street and its rooms draw once, together, under their own heading —
        // rather than scattered through Here and Rooms where they would read as
        // places you are standing in.
        const elsewhere = group.places.filter((p) => p.vantage);
        const rest = group.places.filter((p) => !p.vantage);
        const here = rest.filter((p) => p.kind === "loc");
        const runs = [
          ["summary", "Summary", rest.filter((p) => p.kind === "zone")],
          // A living character stands in one Location; a GM or a ghost watches
          // every one in the game. The mockup heads the first "Here" and the
          // rest "Locations", and for a player that is the same list under the
          // truer of the two words.
          ["here", here.length === 1 ? "Here" : "Locations", here],
          ["rooms", "Rooms", rest.filter((p) => p.kind === "room")],
          ["conversations", "Conversations", rest.filter((p) => p.kind === "conv")],
          ["elsewhere", "Elsewhere", elsewhere],
        ];
        const groupOpen = !shut(key);
        return (
          <div className="chat-zone-group" key={key}>
            {divided && group.zoneName && (
              <button
                type="button"
                className="zone-div fold"
                aria-expanded={groupOpen}
                aria-label={group.zoneName}
                onClick={() => onToggle(key)}
              >
                <ChevronDownIcon data-open={groupOpen ? "true" : undefined} />
                {group.zoneName}
              </button>
            )}
            {groupOpen &&
              runs.map(([slug, title, rows]) => (
                <Section
                  key={slug}
                  title={title}
                  places={rows}
                  foldKey={`${key}:${slug}`}
                  shut={shut(`${key}:${slug}`)}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              ))}
          </div>
        );
      })}

      {/* STICKY BAR (chat-vocabulary.md §1): pinned to the bottom so a GM's
          every-room list cannot push the seat switch below the fold. It takes
          the ground it is pinned over, opaque, because its whole job is hiding
          the rows that slide under it. */}
      <div className="chat-places-tail sticky-bar">
        {viewAs && (
          <div className="chat-view-as" role="group" aria-label="View as">
            <div className="segmented">
              <button type="button" aria-pressed={viewAs.mode === "gm"} onClick={() => viewAs.onChange("gm")}>
                GM
              </button>
              <button type="button" aria-pressed={viewAs.mode === "player"} onClick={() => viewAs.onChange("player")}>
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
            /* Bare .icon-btn, not IconButton: no Tooltip here. aria-label is
               the accessible NAME, not visible copy. */
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
