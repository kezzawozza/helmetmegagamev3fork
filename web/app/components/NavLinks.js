"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutOfDiscord } from "../actions";
import { playChime } from "./chime";
import useChimeMuted from "./useChimeMuted";
import { useNavUnread } from "./navBadge";

// The universal top bar's link row (AppBar.js) — plain, old-fashioned text
// links, left-justified, in the same GM/player groups navItems.js has always
// carried, divided by a vertical rule rather than a heading. This replaces
// NavRail.js: there is no icon-only rail any more, and no mobile "More"
// sheet either — the row simply scrolls sideways under a narrow viewport
// (.scroll-fade-x, AppBar.js), so every item is reachable at any width
// instead of a chosen five plus a drawer.
export default function NavLinks({ items }) {
  const pathname = usePathname();
  const isActive = (href) => pathname === href || pathname.startsWith(`${href}/`);
  // The only rail the chime toggle ever belonged to.
  const isGmBar = items.some((item) => item.section === "gm");
  // Null everywhere but the player desk, where it publishes the shown number (navBadge.js).
  const liveUnread = useNavUnread();
  const badgeFor = (item) =>
    item.href === "/gm/players" && liveUnread != null ? liveUnread : item.badge;
  const [chimeMuted, setChimeMuted] = useChimeMuted();
  const toggleChimeMuted = () => {
    const next = !chimeMuted;
    setChimeMuted(next);
    if (!next) playChime();
  };

  return (
    <nav className="top-bar-nav" aria-label="Main">
      {items.map((item, i) => {
        const divide = i > 0 && item.section !== items[i - 1].section;
        const badge = badgeFor(item);
        return (
          <Fragment key={item.href}>
            {divide && <span className="action-strip-sep" aria-hidden="true" />}
            <Link href={item.href} className="nav-link" data-active={isActive(item.href) ? "true" : "false"}>
              {item.label}
              {badge > 0 && <span className="top-bar-badge mono">{badge}</span>}
            </Link>
          </Fragment>
        );
      })}
      {isGmBar && (
        <>
          <span className="action-strip-sep" aria-hidden="true" />
          <button type="button" className="nav-link" onClick={toggleChimeMuted}>
            {chimeMuted ? "Unmute chime" : "Mute chime"}
          </button>
        </>
      )}
      <span className="action-strip-sep" aria-hidden="true" />
      <form action={signOutOfDiscord}>
        <button type="submit" className="nav-link">
          Sign out
        </button>
      </form>
    </nav>
  );
}
