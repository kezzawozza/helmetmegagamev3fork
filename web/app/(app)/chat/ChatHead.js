"use client";

import { Fragment, useState } from "react";
import IconButton from "@/app/components/IconButton";
import { MenuIcon, PlayersIcon } from "@/app/components/icons";

// The head over a scene: the open place's name, where you are standing above
// it, and the place's own words under it. The feed, the Bascinet pane and
// the faction panel all wear this one — they used to build three slightly
// different heads by hand.
//
// On a phone (under 720px, useNarrow.js) it is also the whole top of the
// screen, the way Discord's channel bar is: ≡ on the left opens the places
// drawer, the people on the right open who is here. Both buttons are drawn
// only when the caller hands over an opener — the GM desk's Scene tab embeds
// the feed and has neither drawer — and CSS keeps them off a desktop, where
// both columns are already on the page.
//
// The description is one clamped line you open with a tap. On a phone there
// is no room for it at all, so the NAME is the button and the line drops in
// under the bar when asked.
export default function ChatHead({
  name,
  crumb = [],
  description = "",
  // The phone's two drawers. Null means no button.
  onOpenPlaces = null,
  onOpenAside = null,
  // A dot on ≡: something was said somewhere else that was about you.
  unreadElsewhere = false,
  // The count on the people button. Null draws the glyph alone.
  hereCount = null,
  // Whatever sits at the right edge: the feed's search, the faction link.
  trailing = null,
}) {
  const [descOpen, setDescOpen] = useState(false);
  const text = description?.trim() || "";
  return (
    <div className="chat-head">
      {onOpenPlaces && (
        <span className="chat-head-phone">
          <IconButton icon={MenuIcon} label="Places" size="lg" onClick={onOpenPlaces} />
          {unreadElsewhere && <span className="chat-dot chat-head-dot" aria-label="Unread elsewhere" />}
        </span>
      )}
      <div className="chat-head-main">
        {/* The name is a button only where it has something to open. A
            heading that looks like a button and does nothing is worse than
            a plain heading. */}
        {text ? (
          <h1 className="section-title">
            <button
              type="button"
              className="chat-head-name"
              aria-expanded={descOpen}
              onClick={() => setDescOpen((open) => !open)}
            >
              {name}
            </button>
          </h1>
        ) : (
          <h1 className="section-title">{name}</h1>
        )}
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
        {text && (
          <button
            type="button"
            className="chat-head-desc"
            data-open={descOpen ? "true" : undefined}
            aria-expanded={descOpen}
            onClick={() => setDescOpen((open) => !open)}
          >
            {text}
          </button>
        )}
      </div>
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
