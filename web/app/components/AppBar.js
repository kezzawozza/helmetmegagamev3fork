import { Suspense } from "react";
import { getOpenTurn } from "@/lib/turn";
import { PLAYER_NAV, loadNavItems } from "@/lib/navItems";
import { SkeletonBar } from "./PageShell";
import NavLinks from "./NavLinks";
import NavLinksAsync from "./NavLinksAsync";
import ClockBlock from "./ClockBlock";
import CommandPalette from "./CommandPalette";

// The universal top bar every page wears now, replacing the left nav rail
// (NavRail.js/AppRail.js) and every page's own AppHeader/DeskHeader: one row
// — old-fashioned text links (NavLinks.js), then a divider, then the game's
// clock (ClockBlock.js) — left-justified, over the double line (.top-bar,
// shell.css). Rendered once per route group, above {children}
// ((app)/layout.js, (desk)/layout.js, (public)/layout.js), and NOT rendered
// at all for a signed-out visitor — that's each layout's own call, matching
// what AppRail used to do.
//
// Two independent Suspense boundaries, mirroring the old AppRail/AppHeader
// split: the nav items promise waits on a GM/Mortus/treasury check and the
// turn promise is its own query, and neither should hold the other off the
// screen.
export default function AppBar({ discordUserId, fallback = PLAYER_NAV }) {
  const turnPromise = getOpenTurn();
  return (
    <>
      <div className="top-bar scroll-fade-x">
        <Suspense fallback={<NavLinks items={fallback} />}>
          <NavLinksAsync itemsPromise={loadNavItems(discordUserId)} />
        </Suspense>
        <span className="action-strip-sep" aria-hidden="true" />
        <Suspense fallback={<SkeletonBar width="10rem" height={14} />}>
          <ClockBlock turnPromise={turnPromise} />
        </Suspense>
      </div>
      {/* Mounted here rather than in the root layout so it only exists for a
          signed-in user — and so all three route groups get it from one place. */}
      <CommandPalette />
    </>
  );
}
