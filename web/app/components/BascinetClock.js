"use client";

import useNowTick from "./useNowTick";
import useHydrated from "./useHydrated";
import { TIME_ZONE } from "@lifeweb/db/lib/turnClock";

// The game's clock, in the header of every page. There is ONE time in
// Ravenheart — real time in America/Chicago — and every deadline the game
// quotes is in it, so the header carries it plainly rather than leaving each
// player to work out what "9:00 PM" meant relative to where they live.
//
// No zone suffix on purpose: a player is not being told about Chicago, they
// are being told what time it is.
//
// Ticks on the shared 30-second beat rather than per second — a seconds hand
// would be a repaint a minute for no information, and REDESIGN.md §9 is
// explicit that nothing here animates.
//
// Nothing renders until hydration, through useHydrated rather than
// suppressHydrationWarning: the server's minute and the browser's are not
// reliably the same minute, and the server's would be stale the moment the
// page was cached anyway. LockChip gets this for free by waiting on its
// provider; this has no provider to wait on.
export default function BascinetClock() {
  const hydrated = useHydrated();
  const now = useNowTick(30_000);
  if (!hydrated) return null;
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(now));
  return (
    <span className="header-note mono" title="The game runs on this clock">
      {time}
    </span>
  );
}
