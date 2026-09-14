"use client";

import { useMoveWindow } from "./MoveWindowProvider";
import useNowTick from "./useNowTick";
import { lockCountdown } from "@/lib/turnFormat";

// When Moves close — "LOCK 9:00 PM · 2h 14m" — in the reader's own timezone
// (TURN-ENGINE.md §6a). No props: numbers come from MoveWindowProvider.
// Renders nothing server-side or during hydration, no suppressHydrationWarning — see useHydrated.js.

// Reader's own clock/locale — not discordTime.js's "t" style, which pads the hour.
function clockTime(ms) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

export default function LockChip() {
  const moveWindow = useMoveWindow();
  const now = useNowTick(30_000);

  if (!moveWindow) return null;
  const { cutoffAtMs, endsAtMs } = moveWindow;

  // Nothing once the turn's own end has passed; next turn's numbers arrive with the next load.
  if (now >= endsAtMs) return null;

  // Derived here, not sent as a boolean, so a desk left open all evening crosses the cutoff honestly.
  const locked = now >= cutoffAtMs;
  const clock = clockTime(cutoffAtMs);
  const countdown = lockCountdown(cutoffAtMs - now);
  if (!locked && !countdown) return null;

  return (
    <span
      className="chip chip-mono"
      data-tone={locked ? "danger" : undefined}
      title="Moves close three hours before the turn ends"
    >
      {locked ? "MOVES LOCKED" : `LOCK ${clock} · ${countdown}`}
    </span>
  );
}
