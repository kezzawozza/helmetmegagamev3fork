import { Suspense } from "react";
import { getOpenTurn } from "@/lib/turn";
import { SkeletonBar } from "./PageShell";
import TurnMeta from "./TurnMeta";
import LockChip from "./LockChip";
import BascinetClock from "./BascinetClock";

// The header every page wears — the artifact's `.app-header` shape (see
// docs/design/mockups/character/index.html and shell.css): a left `.crumbs`
// line, "<b>Title</b> — meta", and a right side holding the page's own
// actions plus where-and-when (TurnMeta.js), each drawn as a quiet control.
// This deliberately does NOT go through DeskHeader any more — DeskHeader is
// its own thing, used directly by the six (desk) workspaces, and changing
// its markup would have reshaped all of them along with this. Not a client
// component and it does not await the turn: the promise goes into a Suspense
// boundary so the bar, title and actions all paint immediately and the chip
// streams in behind them.
export default function AppHeader({ title, meta = null, actions = null }) {
  const turnPromise = getOpenTurn();
  return (
    <div className="app-header">
      <div className="crumbs">
        <b>{title}</b>
        {meta != null && <span className="crumbs-meta"> — {meta}</span>}
      </div>
      <div className="app-header-controls">
        {actions}
        <Suspense fallback={<SkeletonBar width="11rem" height={22} />}>
          <TurnMeta turnPromise={turnPromise} />
        </Suspense>
        {/* Outside the boundary: awaits nothing, reads the root layout's streamed cutoff from context. */}
        <LockChip />
        {/* The game's clock. Awaits nothing either — it is the real time in America/Chicago and needs no query. */}
        <BascinetClock />
      </div>
    </div>
  );
}
