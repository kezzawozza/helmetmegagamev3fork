"use client";

import { useMoveWindow } from "./MoveWindowProvider";
import useNowTick from "./useNowTick";
import { lockCountdown } from "@/lib/turnFormat";
import { TIME_ZONE } from "@lifeweb/db/lib/turnClock";

// When Moves close — "LOCK 9:00 PM · 2h 14m" — or, out of session, that the game is shut. No props: everything comes from
// MoveWindowProvider. Renders nothing server-side or during hydration, no suppressHydrationWarning — see useHydrated.js.

// The GAME's clock, not the reader's. It used to be the reader's own timezone, on the argument that a relative "closes in
// 3 h" made a player two zones over do arithmetic — which was right about the arithmetic and wrong about whose clock. There
// is one time in Ravenheart and everyone talks about it in the same words, so the deadline is shown in that time, with no
// zone suffix, because to a player it is simply the time.
function clockTime(ms) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

export default function LockChip() {
  const moveWindow = useMoveWindow();
  const now = useNowTick(30_000);

  if (!moveWindow) return null;
  const { cutoffAtMs, endsAtMs, frozenReason } = moveWindow;

  // Out of session there is no deadline at all, so there is nothing to count down to — say what is actually true instead.
  // This is the case that would read as "wide open" if it went through the lock logic below, since a frozen clock reports
  // locked: false (db/lib/turnGate.js).
  if (frozenReason === "NOT_IN_SESSION") {
    return (
      <span className="status-pill mono" data-tone="bad" title="The game is between sessions">
        NOT IN SESSION
      </span>
    );
  }
  if (cutoffAtMs == null || endsAtMs == null) return null;

  // Nothing once the turn's own end has passed; next turn's numbers arrive with the next load.
  if (now >= endsAtMs) return null;

  // Derived here, not sent as a boolean, so a desk left open all evening crosses the cutoff honestly.
  const locked = now >= cutoffAtMs;
  const clock = clockTime(cutoffAtMs);
  const countdown = lockCountdown(cutoffAtMs - now);
  if (!locked && !countdown) return null;

  // Locked reuses .status-pill — bold coloured text, no chrome, the app's one
  // grammar for "this means something bad" (DESIGN-SYSTEM.md §6). Ticking
  // down to it is not bad news yet, so it stays .header-note like its
  // neighbours.
  if (locked) {
    return (
      <span className="status-pill mono" data-tone="bad" title="Moves close before the turn ends, so the GMs can adjudicate">
        MOVES LOCKED
      </span>
    );
  }
  return (
    <span className="header-note mono" title="Moves close before the turn ends, so the GMs can adjudicate">
      {`LOCK ${clock} · ${countdown}`}
    </span>
  );
}
