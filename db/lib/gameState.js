// The two singleton rows a game runs on. GameConfig is DURABLE host configuration (Restart Game never
// touches it); GameState is PER-GAME state, deleted and recreated by Restart Game
// (web/app/(app)/gm/dev/actions.js#wipeGameData). Both read through here rather than an inline
// findUnique at every call site. Takes the client as a parameter (db/lib/dm.js convention).

async function getGameConfig(db) {
  return db.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// The id the first Game row was backfilled with (migration 20260911060000_games_outlive_the_wipe).
// Connects by name rather than a fresh cuid, so racing upserts on an empty database can't make two games.
const BOOTSTRAP_GAME_ID = "game1";

// What a brand-new GameState row is, made on the spot if a fresh database has no Game yet.
const GAME_STATE_CREATE = {
  id: 1,
  game: {
    connectOrCreate: { where: { id: BOOTSTRAP_GAME_ID }, create: { id: BOOTSTRAP_GAME_ID } },
  },
};

async function getGameState(db) {
  return db.gameState.upsert({ where: { id: 1 }, update: {}, create: GAME_STATE_CREATE });
}

// Read-only variants for hot read paths — an upsert takes a write lock a page render has no business holding.
async function readGameConfig(db, select) {
  return db.gameConfig.findUnique({ where: { id: 1 }, ...(select ? { select } : {}) });
}

async function readGameState(db, select) {
  return db.gameState.findUnique({ where: { id: 1 }, ...(select ? { select } : {}) });
}

// The denominator for every weighted seat. Start Game stamps the real one; until then the GM's
// "expected players" knob stands in, letting a GM test-create before a lobby has gathered.
function effectivePlayerCount(config, state) {
  return state?.playerCount ?? config?.playerCount ?? 80;
}

// Whether turns tick at all — for everything that derives a DEADLINE from the clock
// (db/lib/turnClock.js#moveWindow): a game not running has no end time to count back from.
function isClockRunning(config, state) {
  return state?.phase === "RUNNING" && !config?.autoTurnAdvanceDisabled;
}

// One round trip for the readers that only want the boolean.
async function clockFrozen(db) {
  const [config, state] = await Promise.all([
    readGameConfig(db, { autoTurnAdvanceDisabled: true }),
    readGameState(db, { phase: true }),
  ]);
  return !isClockRunning(config, state);
}

module.exports = {
  GAME_STATE_CREATE,
  getGameConfig,
  getGameState,
  readGameState,
  effectivePlayerCount,
  clockFrozen,
};
