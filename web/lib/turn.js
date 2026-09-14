import { cache } from "react";
import { prisma } from "@lifeweb/db";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";

// cache() dedupes the multiple call sites needing the open turn into one query per request. No TTL:
// turn state is GM-triggered and some actions need a fresh read right after revalidatePath.
// Pure formatting helpers live in turnFormat.js instead — this file imports @lifeweb/db (Prisma) and
// would drag that barrel into any client component's bundle.
export const getOpenTurn = cache(async () => {
  return prisma.turn.findFirst({ where: { status: "OPEN" } });
});

// When Moves stop being accepted, as two plain numbers the browser can tick against. Nothing stores
// a turn's lock time — db/lib/turnClock.js derives it from `startedAt` (TURN-ENGINE.md §6a). Null
// when there is no turn or no lock at all. Numbers, not Dates, and no `locked` boolean: the header
// client component derives `locked` itself every 30s so a desk left open across the cutoff stays correct.
export const getMoveWindow = cache(async () => {
  const [turn, frozen] = await Promise.all([getOpenTurn(), clockFrozen(prisma)]);
  if (!turn) return null;
  const { cutoffAt, endsAt, hasLock } = moveWindow(turn, { clockFrozen: frozen });
  if (!hasLock) return null;
  return { cutoffAtMs: cutoffAt.getTime(), endsAtMs: endsAt.getTime() };
});
