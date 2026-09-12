"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CharacterIcon,
  PlayersIcon,
  ScaleIcon,
  AuditIcon,
  EconomyIcon,
  FactionIcon,
  DevIcon,
  MessageIcon,
  NotesIcon,
  DocumentsIcon,
  ArchiveIcon,
  LifewebIcon,
  HelpIcon,
  SignOutIcon,
  MoreIcon,
  StoreIcon,
  SpeakerIcon,
  PlayIcon,
  MapIcon,
  EyeIcon,
} from "./icons";
import RailLinkPending from "./RailLinkPending";
import { signOutOfDiscord } from "../actions";
import { playChime } from "./chime";
import useChimeMuted from "./useChimeMuted";
import { useNavUnread } from "./navBadge";

// Exported for Chat's phone drawer, which draws the same links in its foot
// (the bottom bar is hidden on /chat under 720px — see chat/Chat.js).
export const ICONS = {
  character: CharacterIcon,
  play: PlayIcon,
  map: MapIcon,
  players: PlayersIcon,
  turns: ScaleIcon,
  audit: AuditIcon,
  economy: EconomyIcon,
  faction: FactionIcon,
  dev: DevIcon,
  messages: MessageIcon,
  notes: NotesIcon,
  documents: DocumentsIcon,
  oracle: EyeIcon,
  archive: ArchiveIcon,
  lifeweb: LifewebIcon,
  help: HelpIcon,
  store: StoreIcon,
};

// How many items stay in the mobile bottom bar. The rest go behind "More".
//
// A GM carries up to eleven nav items (Players, Adjudicate, Audit, Oracle,
// Dev, then Character, Map, Notes, Documents, Handbook, plus Lifeweb/Archive)
// and Sign out. That many targets across a 390px viewport is well under the 44px
// touch minimum, and visually crammed. Five plus More is ~65px. Players now
// carry six (Character, Map, Faction, Notes, Documents, Handbook) — one over
// the cap, so Handbook is the first thing to fall into the mobile sheet.
// That's the deliberate casualty: it's a read-once reference, unlike the
// other five, which stay in the bar untouched. Sign out lives in the sheet
// too on mobile, for anyone under the cap.
//
// GM_NAV leads with its "gm" section, and Dev is inserted at the end of that
// section rather than appended to the list (navItems.js), so the five a GM
// keeps in the bar are Players, Adjudicate, Audit, Oracle and — for a
// superadmin — Dev. That is the whole job, and every player screen falls into
// the sheet behind More. This comment used to say Character and Map were in
// the bar; Oracle had been added above them and nobody corrected it.
const MOBILE_PRIMARY = 5;

// What a section break is called in the mobile sheet. The desktop rail draws
// it as a plain rule instead: at 56px there is no room for a word, and the
// grouping reads off the gap on its own.
const SECTION_LABELS = { gm: "Gamemaster", player: "You" };

export default function NavRail({ items }) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  const isActive = (href) => pathname === href || pathname.startsWith(`${href}/`);
  const overflow = items.slice(MOBILE_PRIMARY);
  // PLAYER_NAV carries no section at all — see SECTION_LABELS above — so this
  // is also "is this a GM's rail", which is the only rail the chime ever fires
  // on (a player's unread count is hardcoded 0 in loadNavItems).
  const isGmRail = items.some((item) => item.section === "gm");
  // Null everywhere but the player desk, where the desk publishes the number
  // it is actually showing (navBadge.js). The server's badge is the fallback,
  // and the only value a first paint ever has.
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
    <>
      <nav className="app-rail" aria-label="Main">
        {items.map((item, i) => {
          const Icon = ICONS[item.icon];
          // A rule wherever the section changes, never before the first item.
          // PLAYER_NAV sets no section at all, so a player sees none of these —
          // the whole feature costs them nothing.
          const divide = i > 0 && item.section !== items[i - 1].section;
          const badge = badgeFor(item);
          return (
            <Fragment key={item.href}>
            {divide && (
              <span
                className={i >= MOBILE_PRIMARY ? "rail-divider rail-item--overflow" : "rail-divider"}
                aria-hidden="true"
              />
            )}
            <Link
              href={item.href}
              // Beyond the cap, an item is hidden in the bottom bar only —
              // the desktop rail still shows everything.
              className={i >= MOBILE_PRIMARY ? "rail-item rail-item--overflow" : "rail-item"}
              data-active={isActive(item.href) ? "true" : "false"}
              // The desktop rail is icon-only, so the label is visually hidden
              // rather than removed: it stays the accessible name, and title
              // gives it back to a sighted mouse user on hover.
              title={item.label}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
              {badge > 0 && <span className="rail-item-badge mono">{badge}</span>}
              <RailLinkPending />
            </Link>
            </Fragment>
          );
        })}

        {/* Mobile only; the desktop rail has room for everything plus a
            dedicated Sign out at the bottom. */}
        <button
          type="button"
          className="rail-item rail-more"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((v) => !v)}
        >
          <MoreIcon aria-hidden="true" />
          <span>More</span>
        </button>

        {isGmRail && (
          <button
            type="button"
            className="rail-item"
            onClick={toggleChimeMuted}
            title={chimeMuted ? "Unmute message chime" : "Mute message chime"}
          >
            <SpeakerIcon muted={chimeMuted} aria-hidden="true" />
            <span>{chimeMuted ? "Unmute chime" : "Mute chime"}</span>
          </button>
        )}

        <form action={signOutOfDiscord} className="rail-signout">
          <button type="submit" className="rail-item" style={{ width: "100%" }} title="Sign out">
            <SignOutIcon aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </form>
      </nav>

      {sheetOpen && (
        <div className="modal-overlay nav-sheet-overlay" onClick={() => setSheetOpen(false)}>
          <div className="nav-sheet" onClick={(e) => e.stopPropagation()}>
            {overflow.map((item, i) => {
              const Icon = ICONS[item.icon];
              // The sheet has width for a word, so the same break shows as a
              // heading here rather than the rail's bare rule.
              const heading =
                (i === 0 || item.section !== overflow[i - 1].section) &&
                SECTION_LABELS[item.section];
              return (
                <Fragment key={item.href}>
                {heading && <span className="rail-section-label">{heading}</span>}
                <Link
                  href={item.href}
                  className="menu-item nav-sheet-item"
                  data-active={isActive(item.href) ? "true" : "false"}
                  // Close on the way out, or the sheet stays over the page you
                  // just asked for. Done here rather than in an effect on
                  // pathname, which would be a cascading render.
                  onClick={() => setSheetOpen(false)}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                  <RailLinkPending />
                </Link>
                </Fragment>
              );
            })}
            {isGmRail && (
              <button
                type="button"
                className="menu-item nav-sheet-item"
                style={{ width: "100%" }}
                onClick={toggleChimeMuted}
              >
                <SpeakerIcon muted={chimeMuted} aria-hidden="true" />
                <span>{chimeMuted ? "Unmute chime" : "Mute chime"}</span>
              </button>
            )}
            <form action={signOutOfDiscord}>
              <button type="submit" className="menu-item nav-sheet-item" style={{ width: "100%" }}>
                <SignOutIcon aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
