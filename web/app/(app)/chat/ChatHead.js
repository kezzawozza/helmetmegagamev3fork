"use client";

import { Fragment } from "react";
import IconButton from "@/app/components/IconButton";
import { MenuIcon, PlayersIcon } from "@/app/components/icons";

// The head over a scene: ONE `.bar` (the mockup's, docs/design/mockups/chat/
// index.html) — the open place's name, then `.crumb` (zone · kind), then a
// spacer, then `.sub` saying how many are here. The feed, the Bascinet pane
// and the faction panel all wear this one — they used to build three
// slightly different heads by hand.
//
// The place's own WORDS are not this component's to print. They used to run
// a third line under the crumb, which is what put "The coziest part of
// Ravenheart…" wrapping under the You panel and off the edge of the column —
// a head is where you are, not what it looks like. That prose already has a
// home: the first line PlaceCard.js prints in the aside, always on the page.
//
// On a phone (under 720px, useNarrow.js) it is also the whole top of the
// screen, the way Discord's channel bar is: ≡ on the left opens the places
// drawer, the people on the right open who is here. Both buttons are drawn
// only when the caller hands over an opener — the GM desk's Scene tab embeds
// the feed and has neither drawer — and CSS keeps them off a desktop, where
// both columns are already on the page.
export default function ChatHead({
  name,
  crumb = [],
  // The phone's two drawers. Null means no button.
  onOpenPlaces = null,
  onOpenAside = null,
  // A dot on ≡: something was said somewhere else that was about you.
  unreadElsewhere = false,
  // The count on the people button. Null draws the glyph alone.
  hereCount = null,
  // Whatever sits at the right edge — the feed's search, for instance.
  trailing = null,
}) {
  return (
    <div className="chat-head bar">
      {onOpenPlaces && (
        <span className="chat-head-phone">
          <IconButton icon={MenuIcon} label="Places" size="lg" onClick={onOpenPlaces} />
          {unreadElsewhere && <span className="chat-dot chat-head-dot" aria-label="Unread elsewhere" />}
        </span>
      )}
      <h1 className="chat-head-name">{name}</h1>
      {crumb.length > 0 && (
        <span className="crumb">
          {crumb.map((part, i) => (
            <Fragment key={part}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              {part}
            </Fragment>
          ))}
        </span>
      )}
      <span className="spacer" />
      {hereCount != null && hereCount > 0 && <span className="sub">{hereCount} here</span>}
      {trailing}
      {onOpenAside && (
        <span className="chat-head-phone">
          <IconButton icon={PlayersIcon} label="Who is here" size="lg" onClick={onOpenAside} />
          {hereCount != null && hereCount > 0 && <span className="chat-head-count mono">{hereCount}</span>}
        </span>
      )}
    </div>
  );
}
