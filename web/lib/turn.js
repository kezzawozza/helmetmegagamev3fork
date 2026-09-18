import { cache } from "react";
import { prisma } from "@lifeweb/db";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockStatus } from "@lifeweb/db/lib/gameState";

export const getOpenTurn = cache(async () => {
  return prisma.turn.findFirst({ where: { status: "OPEN" } });
});

// What the chip every header wears needs (LockChip.js). Numbers, not Dates, and no `locked` boolean: a desk sits open for
// hours and has to cross the cutoff honestly, so the browser derives `locked` itself every 30s.
//
// `frozenReason` rides along because a frozen clock has NO lock — and "no lock" and "the game is shut" are two different
// things to draw. Returning null for both is what would have let a Sessions game look wide open.
export const getMoveWindow = cache(async () => {
  const [turn, clock] = await Promise.all([getOpenTurn(), clockStatus(prisma)]);
  if (!turn) return null;
  const { cutoffAt, endsAt, hasLock } = moveWindow(turn, { clockFrozen: clock.frozen });
  if (!hasLock) return clock.reason ? { cutoffAtMs: null, endsAtMs: null, frozenReason: clock.reason } : null;
  return { cutoffAtMs: cutoffAt.getTime(), endsAtMs: endsAt.getTime(), frozenReason: null };
});
