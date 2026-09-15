// The Discord mirror — the database is the master, and Discord is a picture of
// it that the mirror keeps true.
//
// A run has two halves. First the OBJECTS: desired.js turns the rows into the
// roles, categories, channels, threads and pinned anchors that ought to exist,
// live.js takes one snapshot of the guild, diff.js compares them into an
// ordered op list, and apply.js walks it. Then the PEOPLE: sweeps.js runs the
// channel doctor's sweeps, which reconcile who holds which role and who can
// open which channel. `scope` says how far it goes —
//
//   "structure"  the op list only. Cheap, no member walk.
//   "cheap"      plus the structure and role-membership sweeps. Bot restart,
//                end of every turn.
//   "full"       plus overwrites, threads, narrowcast and #turns access.
//
// `apply: false` reads and reports; `apply: true` writes. Both land as a
// SystemReport so /gm/dev can show what the last run did.
//
// This is the repair path now: runChannelDoctor is a thin alias over it
// (db/lib/channelDoctor.js), so the bot's ready pass and the turn wrapup come
// through here too, and a Location whose channel was deleted is rebuilt rather
// than reported with a pointer to a sync command that no longer exists — the
// mirror is the repair path now.
const { isLocalMode } = require("../localMode");
const { spectatorsVisibleNow } = require("../spectatorAccess");
const { loadLiveStates } = require("../roomLive");
const { roomComponents } = require("../syncZones/roomThreads");
const { makeReporter } = require("../channelDoctor/shared");
const { buildDesired } = require("./desired");
const { loadLiveSnapshot, snapshotFromDesired } = require("./live");
const { buildOps } = require("./diff");
const { applyOps } = require("./apply");
const { runSweeps } = require("./sweeps");

// Everything desired.js needs, in as few queries as it takes.
async function loadRows(prisma) {
  const [zones, locations, rooms, config] = await Promise.all([
    prisma.zone.findMany({ where: { retiredAt: null }, orderBy: { sortOrder: "asc" } }),
    prisma.location.findMany({ where: { retiredAt: null }, orderBy: { sortOrder: "asc" } }),
    prisma.room.findMany({ where: { retiredAt: null }, orderBy: { sortOrder: "asc" } }),
    // Upsert, not findUnique — an empty database (LOCAL_MODE's first run, or a
    // fresh Postgres nobody has synced yet) has no GameConfig row at all, and
    // an adopt op that tries to write one of its columns back would throw
    // P2025.
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
  ]);

  // The two things desired.js cannot work out for itself, because both need
  // the database: a room's live line and its button rows.
  const liveStates = await loadLiveStates(prisma, rooms.map((r) => r.live).filter(Boolean));
  const componentsByRoomId = new Map();
  for (const room of rooms) {
    componentsByRoomId.set(room.id, await roomComponents(prisma, room, room.locationId));
  }

  return { zones, locations, rooms, config, liveStates, componentsByRoomId };
}

// `targets` narrows a run to part of the world: `[{ targetType: "location",
// targetId: "abc" }]` is one Location's channel, its anchor and its rooms'
// threads; `[{ targetType: "special" }]` is every radio net. It is what the
// MirrorJob queue drains with, and what db:sync-narrowcast-channels and
// db:sync-deadchat became. A selector with no targetId means every subject of
// that type.
function selectTargets(desired, targets) {
  if (!targets || targets.length === 0) return desired;
  const selectors = targets.map((t) => ({
    type: String(t.targetType ?? t.type ?? ""),
    id: t.targetId ?? t.id ?? null,
  }));
  if (selectors.some((s) => s.type === "all")) return desired;
  return desired.filter((target) => {
    const subject = target.subject;
    if (!subject) return false;
    return selectors.some((s) => s.type === subject.type && (s.id == null || String(s.id) === String(subject.id)));
  });
}

async function runDiscordMirror(
  prisma,
  {
    apply = false,
    // The structure ops (create, adopt, rename, reparent) are the half that can
    // put new objects on the real guild. An automatic run (bot start, turn end)
    // holds them until MIRROR_AUTO_STRUCTURE=1 says somebody has looked at the
    // preview once; an explicit run (Reconcile now, db:mirror --apply, the
    // editor's queue) always applies them.
    applyStructure = apply,
    scope = "structure",
    actorDiscordUserId = null,
    targets = null,
    reportKind = "MIRROR",
  } = {},
) {
  const startedAt = new Date();
  const findings = [];
  const errors = [];
  const report = makeReporter(findings, apply);

  const rows = await loadRows(prisma);
  const spectators = await spectatorsVisibleNow(prisma);

  const allDesired = buildDesired({
    zones: rows.zones,
    locations: rows.locations,
    rooms: rows.rooms,
    config: rows.config,
    spectators,
    liveStates: rows.liveStates,
    componentsByRoomId: rows.componentsByRoomId,
    guildId: process.env.DISCORD_GUILD_ID,
  });
  const desired = selectTargets(allDesired, targets);

  // LOCAL_MODE answers every Discord read with "nothing exists", so its picture
  // of the guild is built from the ids the rows already carry instead. See
  // live.js#snapshotFromDesired for why an empty snapshot would be actively
  // wrong there rather than merely blank.
  const haveGuild = Boolean(process.env.DISCORD_GUILD_ID && process.env.DISCORD_TOKEN) && !isLocalMode();
  let live = haveGuild ? await loadLiveSnapshot() : snapshotFromDesired(allDesired);

  const { ops, findings: diffFindings } = buildOps({ desired, live, prisma, scope });
  findings.push(...diffFindings);

  if (apply && !applyStructure && ops.length > 0) {
    report("mirror-held", `${ops.length} structure change(s) held: set MIRROR_AUTO_STRUCTURE=1 or press Reconcile now`);
  }
  const { ran, deferred, failures: opFailures } = await applyOps(ops, { apply: apply && applyStructure });

  // Sweeps read `live` next, and it is the snapshot taken BEFORE the ops above
  // ran. A create or adopt that just succeeded put a Location channel (or a
  // Room thread) in front of Discord — or, in LOCAL_MODE, on the row — that
  // this picture never saw, and the occupancy sweep below would find nothing
  // there to open. So when apply actually made one, take the picture again
  // before the sweeps read it. This only fires on the rare run that just built
  // something; the ordinary "nothing changed" pass never re-snapshots.
  const madeSomething = ran.some(
    (op) =>
      op.status === "ran" &&
      (op.targetType === "channel" || op.targetType === "thread") &&
      (op.kind === "create" || op.kind === "adopt"),
  );
  if (apply && madeSomething) {
    live = haveGuild
      ? await loadLiveSnapshot()
      : snapshotFromDesired(
          buildDesired({ ...(await loadRows(prisma)), spectators, guildId: process.env.DISCORD_GUILD_ID }),
        );
  }

  // The member half. It reports and repairs through the same reporter, so a
  // doctor caller reading `findings` sees exactly what it always did.
  if (!targets) {
    try {
      await runSweeps(prisma, { scope, report, errors, live });
    } catch (err) {
      errors.push({ check: "mirror-sweeps", target: scope, message: err?.message ?? String(err) });
    }
  }

  const byKind = {};
  for (const op of ops) byKind[op.kind] = (byKind[op.kind] ?? 0) + 1;
  const byCheck = {};
  for (const f of findings) byCheck[f.check] = (byCheck[f.check] ?? 0) + 1;

  const failures = [
    ...opFailures,
    ...errors,
    ...findings.filter((f) => f.error).map((f) => ({ check: f.check, target: f.target, message: f.error })),
  ];

  const result = {
    scope,
    apply,
    applied: apply,
    ops,
    ran,
    deferred,
    findings,
    failures,
    // Both halves of a run count: an op that actually ran (rebuilt a category,
    // created a missing channel) is a repair just as much as a sweep finding
    // that fixed itself, and the bot's ready-log line reads this number.
    repaired: ran.filter((op) => op.status === "ran").length + findings.filter((f) => f.repaired).length,
  };

  await prisma.systemReport
    .create({
      data: {
        kind: reportKind,
        startedAt,
        finishedAt: new Date(),
        ok: failures.length === 0,
        actorDiscordUserId,
        summary: {
          scope,
          apply,
          applied: apply,
          guild: haveGuild ? "live" : "local",
          targets: desired.length,
          ops: ops.length,
          deferred: deferred.length,
          byKind,
          findings: findings.length,
          repaired: result.repaired,
          byCheck,
        },
        failures: [
          ...failures,
          ...findings
            .filter((f) => !f.repaired && !f.error)
            .map((f) => ({ check: f.check, target: f.target, message: f.problem })),
        ],
      },
    })
    .catch((err) => console.error("mirror: report write failed:", err.message));

  return result;
}

module.exports = { runDiscordMirror };
