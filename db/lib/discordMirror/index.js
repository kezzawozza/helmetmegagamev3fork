// The Discord mirror — the database is the master, and Discord is a picture of
// it that the mirror keeps true.
//
// PHASE 0. Today this only ever LOOKS. `apply: true` is accepted and then
// ignored with a line in the log, so this can ship beside the existing sync and
// the channel doctor without changing a thing either of them does. What it
// proves is agreement: run it against a database db:sync-zones has just
// finished with, and it should report zero ops. Anything it reports instead is
// a place where the mirror and the sync disagree about the world, and that is
// worth knowing before Phase 1 hands it the keys.
//
// The four halves, each in its own file: desired.js (rows -> what should
// exist, pure), live.js (one guild snapshot), diff.js (the ordered op list,
// adopting by name before creating anything), apply.js (a sequential walk that
// stops when the Discord breaker is open).
const { isLocalMode } = require("../localMode");
const { spectatorsVisibleNow } = require("../spectatorAccess");
const { loadLiveStates } = require("../roomLive");
const { roomComponents } = require("../syncZones/roomThreads");
const { buildDesired } = require("./desired");
const { loadLiveSnapshot, emptySnapshot, normalizeChannelName } = require("./live");
const { buildOps } = require("./diff");
const { applyOps } = require("./apply");

// Everything desired.js needs, in as few queries as it takes.
async function loadRows(prisma) {
  const [zones, locations, rooms, config, state] = await Promise.all([
    prisma.zone.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.location.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.room.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.gameState.findUnique({ where: { id: 1 }, select: { phase: true } }),
  ]);

  // The two things desired.js cannot work out for itself, because both need
  // the database: a room's live line and its button rows.
  const liveStates = await loadLiveStates(prisma, rooms.map((r) => r.live).filter(Boolean));
  const componentsByRoomId = new Map();
  for (const room of rooms) {
    componentsByRoomId.set(room.id, await roomComponents(prisma, room, room.locationId));
  }

  return { zones, locations, rooms, config: config ?? {}, state, liveStates, componentsByRoomId };
}

async function runDiscordMirror(prisma, { apply = false, scope = "structure", actorDiscordUserId = null } = {}) {
  const startedAt = new Date();

  if (apply) {
    console.log(
      "mirror: apply is inert until Phase 1 — this run reads Discord and the database and writes neither.",
    );
  }
  const reallyApply = false;

  const rows = await loadRows(prisma);
  const spectators = await spectatorsVisibleNow(prisma);

  const desired = buildDesired({
    zones: rows.zones,
    locations: rows.locations,
    rooms: rows.rooms,
    config: rows.config,
    spectators,
    liveStates: rows.liveStates,
    componentsByRoomId: rows.componentsByRoomId,
  });

  // With no guild to look at, everything reads as "nothing exists yet", which
  // is the honest answer rather than a crash.
  const haveGuild = Boolean(process.env.DISCORD_GUILD_ID && process.env.DISCORD_TOKEN) && !isLocalMode();
  const live = haveGuild ? await loadLiveSnapshot() : emptySnapshot();

  const { ops, findings } = buildOps({ desired, live, prisma, scope });
  const { ran, deferred, failures } = await applyOps(ops, {
    apply: reallyApply,
    reason: "apply is inert until Phase 1",
  });

  const byKind = {};
  for (const op of ops) byKind[op.kind] = (byKind[op.kind] ?? 0) + 1;
  const byCheck = {};
  for (const f of findings) byCheck[f.check] = (byCheck[f.check] ?? 0) + 1;

  const result = {
    scope,
    apply,
    applied: reallyApply,
    ops,
    ran,
    deferred,
    findings,
    failures,
    repaired: ran.filter((r) => r.status === "ran").length,
  };

  await prisma.systemReport
    .create({
      data: {
        kind: "MIRROR",
        startedAt,
        finishedAt: new Date(),
        ok: failures.length === 0,
        actorDiscordUserId,
        summary: {
          scope,
          apply,
          applied: reallyApply,
          guild: haveGuild ? "live" : "none",
          targets: desired.length,
          ops: ops.length,
          byKind,
          findings: findings.length,
          byCheck,
        },
        failures: [
          ...failures,
          ...findings.map((f) => ({ check: f.check, target: f.target, message: f.problem })),
        ],
      },
    })
    .catch((err) => console.error("mirror: report write failed:", err.message));

  return result;
}

module.exports = {
  runDiscordMirror,
  buildDesired,
  buildOps,
  applyOps,
  loadLiveSnapshot,
  emptySnapshot,
  normalizeChannelName,
};
