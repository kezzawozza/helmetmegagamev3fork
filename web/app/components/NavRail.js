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

// How many items stay in the mobile bottom bar; the rest go behind "More".
// A GM keeps Players, Adjudicate, Audit, Oracle, and (superadmin) Dev
// (navItems.js). Players keep Character, Map, Notes, Documents —
// Handbook falls into the sheet as the deliberate casualty (a read-once reference).
const MOBILE_PRIMARY = 5;

// A section break in the mobile sheet; the desktop rail draws a plain rule at 56px instead.
const SECTION_LABELS = { gm: "Gamemaster", player: "You" };

export default function NavRail({ items }) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  const isActive = (href) => pathname === href || pathname.startsWith(`${href}/`);
  const overflow = items.slice(MOBILE_PRIMARY);
  // Also "is this a GM's rail" — the only rail the chime ever fires on.
  const isGmRail = items.some((item) => item.section === "gm");
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
    <>
      <nav className="app-rail" aria-label="Main">
        {items.map((item, i) => {
          const Icon = ICONS[item.icon];
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
              className={i >= MOBILE_PRIMARY ? "rail-item rail-item--overflow" : "rail-item"}
              data-active={isActive(item.href) ? "true" : "false"}
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

        {/* Mobile only. */}
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
                  // Closes here, not in an effect on pathname, which would be a cascading render.
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
