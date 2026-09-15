// The web's view of the shared move economy. The implementation moved to
// db/lib/moveEconomy.js once the bot needed it too (a player withdrawing their own
// Gambit); this file stays so the Dev Panel and the Moves desk keep their import path,
// and so there is exactly one copy of "giving a turn back means deleting the Action".
export {
  MOVE_LOCK_TTL_MS,
  lockIsLive,
  deleteActionRestoringTurn,
} from "@lifeweb/db/lib/moveEconomy";

export async function findOpenTurnAction(prisma, characterId) {
  const openTurn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, phase: true },
  });
  if (!openTurn) return { openTurn: null, action: null };

  const action = await prisma.action.findFirst({
    where: { characterId, turnId: openTurn.id },
    include: { character: true },
  });
  return { openTurn, action };
}
