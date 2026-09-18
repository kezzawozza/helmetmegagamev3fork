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

// Whether the game is inside a session right now. PERSISTENT is always in session — the mode exists so a game can be shut
// between sittings, and a game that never shuts has nothing to ask. In SESSIONS, `sessionOpenedAt` non-null IS the answer:
// the bot's per-minute cron and a GM's Start now both write it through db/lib/session.js, so there is one source of truth
// and no clock arithmetic at read time.
function inSession(config, state) {
  if (config?.gameMode !== "SESSIONS") return true;
  return state?.sessionOpenedAt != null;
}

// Whether turns tick at all — for everything that derives a DEADLINE from the clock
// (db/lib/turnClock.js#moveWindow): a game not running has no end time to count back from. Out of session is the same kind
// of answer, which is why it belongs here: there is no scheduled end between sessions either.
//
// WHAT THIS IS NOT: a gate on whether a player may act. A frozen clock makes moveWindow report `locked: false`, because
// freezing removes the deadline rather than shutting the game. db/lib/turnGate.js#movesOpen is the gate.
function isClockRunning(config, state) {
  return state?.phase === "RUNNING" && !config?.autoTurnAdvanceDisabled && inSession(config, state);
}

// Why the clock is stopped, for the surfaces that have to say it out loud. Ordered by what a player most needs to hear:
// a game that has not started or has ended outranks a session boundary, which outranks a GM's pause.
function frozenReason(config, state) {
  if (state?.phase !== "RUNNING") return "NOT_RUNNING";
  if (!inSession(config, state)) return "NOT_IN_SESSION";
  if (config?.autoTurnAdvanceDisabled) return "PAUSED";
  return null;
}

// The columns every reader of the two predicates above needs. One place, so a caller cannot half-select and get a
// confidently wrong answer — a missing `gameMode` reads as PERSISTENT, which fails OPEN.
const CLOCK_CONFIG_SELECT = { autoTurnAdvanceDisabled: true, gameMode: true };
const CLOCK_STATE_SELECT = { phase: true, sessionOpenedAt: true };

// One round trip for the readers that only want the boolean.
async function clockFrozen(db) {
  return (await clockStatus(db)).frozen;
}

// The same round trip for the readers that need the words as well.
async function clockStatus(db) {
  const [config, state] = await Promise.all([
    readGameConfig(db, CLOCK_CONFIG_SELECT),
    readGameState(db, CLOCK_STATE_SELECT),
  ]);
  return {
    frozen: !isClockRunning(config, state),
    inSession: inSession(config, state),
    reason: frozenReason(config, state),
  };
}

module.exports = {
  GAME_STATE_CREATE,
  CLOCK_CONFIG_SELECT,
  CLOCK_STATE_SELECT,
  getGameConfig,
  getGameState,
  readGameConfig,
  readGameState,
  effectivePlayerCount,
  inSession,
  isClockRunning,
  frozenReason,
  clockFrozen,
  clockStatus,
};
