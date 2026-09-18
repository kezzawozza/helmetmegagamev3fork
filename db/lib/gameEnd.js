// Ending a game, from either direction: the superadmin's End Game button or
// the bomb (docs/systemdocs/LOBBY.md §7). One function so both write the same
// things — GameState to ENDED, the Game row's end, note and epilogue — and
// both hand back the same Discord post for the caller to send. Ended locks
// only the clock: late join and every other action keep working until
// Restart Game.

const { Prisma } = require("@prisma/client");
const { buildEpilogue, formatEpilogue } = require("./epilogue");
const { postMessageBatched } = require("./discordRest");

async function endGameInDb(db, { closingNote = null, reason = "gm", actorDiscordUserId = "system" } = {}) {
  const state = await db.gameState.findUnique({ where: { id: 1 }, include: { game: true } });
  if (!state || state.phase === "ENDED") return { ended: false, state };

  const endedAt = new Date();
  const note = closingNote ?? state.closingNote ?? null;
  const epilogue = await buildEpilogue(db, { game: state.game, state: { ...state, endedAt }, closingNote: note });

  await db.gameState.update({
    where: { id: 1 },
    data: { phase: "ENDED", endedAt, closingNote: note },
  });
  await db.game.update({
    where: { id: state.gameId },
    data: { endedAt, closingNote: note, playerCount: state.playerCount, startedAt: state.startedAt, epilogue },
  });
  await db.auditLog
    .create({
      data: {
        actorDiscordUserId,
        actionType: "game_ended",
        // gameId, because a restart wipes the audit log and the turn number
        // alone cannot say which game a row belonged to.
        details: { reason, gameId: state.gameId, closingNote: note },
      },
    })
    .catch((err) => console.error("game_ended audit failed:", err));

  return { ended: true, epilogue, post: formatEpilogue(epilogue) };
}

// The undo.
//
// The ENDING itself is withdrawn, though, and it did not used to be: the
// epilogue and the closing note stayed on the Game row "until the next ending
// overwrites it". So a resumed game went on running with a full reveal hanging
// off it — /archive kept rendering "How it ended" over a game that was still
// being played, which is what a GM sees as the game having ended twice. If the
// clock is ticking again, the game has not ended, and the reveal has to go
// with the end stamp rather than outlive it. What the players already read in
// #turns stands; a Discord post cannot be unsent, and a game that really is
// over gets a fresh epilogue built at that moment anyway.
async function resumeGameInDb(db, { actorDiscordUserId = "system" } = {}) {
  const state = await db.gameState.findUnique({ where: { id: 1 } });
  if (!state || state.phase !== "ENDED") return { resumed: false };
  await db.gameState.update({
    where: { id: 1 },
    data: { phase: "RUNNING", endedAt: null, closingNote: null },
  });
  await db.game.update({
    where: { id: state.gameId },
    data: { endedAt: null, closingNote: null, epilogue: Prisma.DbNull },
  });
  await db.auditLog
    .create({ data: { actorDiscordUserId, actionType: "game_resumed", details: { gameId: state.gameId } } })
    .catch((err) => console.error("game_resumed audit failed:", err));
  return { resumed: true };
}

// Posts the reveal to #turns. Best-effort; the game is already ended.
async function postGameEnded(db, post) {
  const config = await db.gameConfig.findUnique({ where: { id: 1 }, select: { turnsConsoleChannelId: true } });
  if (!config?.turnsConsoleChannelId) return false;
  await postMessageBatched(config.turnsConsoleChannelId, post);
  return true;
}

module.exports = { endGameInDb, resumeGameInDb, postGameEnded };
