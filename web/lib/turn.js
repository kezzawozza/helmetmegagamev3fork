import { cache } from "react";
import { prisma } from "@lifeweb/db";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";

export const getOpenTurn = cache(async () => {
  return prisma.turn.findFirst({ where: { status: "OPEN" } });
});

// Nothing stores a turn's lock time — db/lib/turnClock.js derives it from `startedAt`
// (TURN-ENGINE.md §6a). Numbers, not Dates, and no `locked` boolean: the header derives `locked` itself every 30s.
export const getMoveWindow = cache(async () => {
  const [turn, frozen] = await Promise.all([getOpenTurn(), clockFrozen(prisma)]);
  if (!turn) return null;
  const { cutoffAt, endsAt, hasLock } = moveWindow(turn, { clockFrozen: frozen });
  if (!hasLock) return null;
  return { cutoffAtMs: cutoffAt.getTime(), endsAtMs: endsAt.getTime() };
});
