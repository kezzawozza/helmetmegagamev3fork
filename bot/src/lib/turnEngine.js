const { prisma, advanceTurn: advanceTurnInDb } = require("@lifeweb/db");

// Thin wrapper around the shared db.advanceTurn(): adds the process-specific
// audit log entry. Called by the per-minute poll in ready.js, and safe to call
// manually as a GM force-advance since it's idempotent about which turn is
// "current". Side effects are awaited inline here (unlike the web action,
// which defers past the response) since nobody is waiting on this cron.
async function advanceTurn() {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (config?.autoTurnAdvanceDisabled) {
    console.log("Turn-advance cron skipped: autoTurnAdvanceDisabled is on.");
    return null;
  }

  const { advanced, refused, previousTurn, newTurn, runSideEffects } = await advanceTurnInDb();

  // Clock stopped by design (LOBBY.md §1): lobby or ended.
  if (refused === "NOT_RUNNING") {
    console.log("Turn-advance cron skipped: the game is not in its Running phase.");
    return null;
  }

  // Between sittings (SESSIONS.md). Not a failure, and not worth a line every minute — the poll in ready.js does not even
  // get this far, since a frozen clock has no due deadline; this is the belt for a GM's force-advance.
  if (refused === "NOT_IN_SESSION") return null;

  if (!advanced) return newTurn; // another caller already won the race

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: "system",
      actionType: "turn_advanced",
      details: {
        previousTurnId: previousTurn?.id ?? null,
        newTurnId: newTurn.id,
        number: newTurn.number,
        dayNumber: newTurn.dayNumber,
      },
    },
  });

  await runSideEffects();

  return newTurn;
}

module.exports = { advanceTurn };
