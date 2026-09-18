import { Suspense } from "react";
import { getOpenTurn } from "@/lib/turn";
import DeskHeader from "./DeskHeader";
import { SkeletonBar } from "./PageShell";
import TurnMeta from "./TurnMeta";
import LockChip from "./LockChip";
import BascinetClock from "./BascinetClock";

// The header every page wears: `DeskHeader` plus where you are and when it is (TurnMeta.js), which no page has to
// remember on its own. Not a client component and it does not await the turn: the promise goes into a Suspense
// boundary so the bar, title and actions all paint immediately and the chip streams in behind them. `meta` is for
// a page's OWN chips and sits before the turn, nearest the title.
export default function AppHeader({ title, meta = null, actions = null }) {
  const turnPromise = getOpenTurn();
  return (
    <DeskHeader
      title={title}
      meta={
        <>
          {meta}
          <Suspense fallback={<SkeletonBar width="11rem" height={22} />}>
            <TurnMeta turnPromise={turnPromise} />
          </Suspense>
          {/* Outside the boundary: awaits nothing, reads the root layout's streamed cutoff from context. */}
          <LockChip />
          {/* The game's clock. Awaits nothing either — it is the real time in America/Chicago and needs no query. */}
          <BascinetClock />
        </>
      }
      actions={actions}
    />
  );
}
