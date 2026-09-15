// The channel doctor — the reconciliation sweep that compares what the
// database says the game looks like against what Discord actually shows,
// reports every mismatch, and (with apply) repairs it. Runs on bot restart
// and after each turn advance (cheap scope), and from finishGameWipe (full).
//
// "cheap": role membership, Location channel occupancy, and structural
// checks — safe on every restart.
// "full": adds channel overwrites, thread/invite bookkeeping, and
// narrowcast overwrites — the expensive halves.
//
// Dry-run by default (apply: false). Every run is persisted as a
// SystemReport (kind: DOCTOR) the Dev Panel renders.
//
// The sweeps themselves live in db/lib/channelDoctor/ (W2d) — this file
// keeps setup, the shared context, and the sweep sequence.
const { getGuildRoles, listGuildMembers } = require("./discordRest");
const { CURSE_SELECT } = require("./curse");
const { spectatorsVisible } = require("./spectatorAccess");
const { gmRoleIdFor } = require("./zoneChannelSpec");
const { makeReporter } = require("./channelDoctor/shared");
const { runStructureSweep } = require("./channelDoctor/sweeps/structure");
const { runRoleMembershipSweep } = require("./channelDoctor/sweeps/roles");
const { runOverwritesSweep } = require("./channelDoctor/sweeps/overwrites");
const { runThreadsSweep } = require("./channelDoctor/sweeps/threads");
const { runNarrowcastSweep } = require("./channelDoctor/sweeps/narrowcast");
const { runTurnsAccessSweep } = require("./channelDoctor/sweeps/turnsAccess");

async function runChannelDoctor(prisma, { apply = false, scope = "cheap", actorDiscordUserId = null } = {}) {
  const startedAt = new Date();
  const findings = [];
  const errors = [];
  const report = makeReporter(findings, apply);

  const [zones, characters, liveRoles, memberList, config] = await Promise.all([
    prisma.zone.findMany({
      include: { seatZone: { select: { kind: true } }, locations: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.character.findMany({
      select: {
        id: true,
        name: true,
        discordRoleId: true,
        zoneId: true,
        locationId: true,
        turnPingOptIn: true,
        webOnly: true,
        // status and discordUserId come from here too — spreading it is what
        // keeps the ghost reconcile below reading the same fields the rule
        // does. Drop one and db/lib/curse.js answers from undefined.
        ...CURSE_SELECT,
      },
    }),
    getGuildRoles(),
    listGuildMembers(),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  // The spectator seat's view bits follow the phase (db/lib/spectatorAccess.js);
  // every spec below and the cheap check carry this one answer.
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { phase: true } });
  const spectators = spectatorsVisible(state?.phase);

  const members = new Map(memberList.map((m) => [m.user.id, m]));
  const rolesById = new Map(liveRoles.map((r) => [r.id, r]));
  const alive = characters.filter((c) => c.status === "ALIVE");
  const zonesById = new Map(zones.map((z) => [z.id, z]));
  const locations = zones.flatMap((z) =>
    z.locations.map((l) => ({ ...l, zoneName: z.name, zoneGmRoleId: gmRoleIdFor(z, zonesById) })),
  );
  const locationsById = new Map(locations.map((l) => [l.id, l]));

  // --- cheap: structure ------------------------------------------------

  const { liveLocationChannels } = await runStructureSweep({
    report,
    prisma,
    zones,
    locations,
    locationsById,
    rolesById,
    members,
    alive,
  });

  // --- cheap: role membership -----------------------------------------

  const { zoneRoleIds, zoneGmRoleIds } = await runRoleMembershipSweep({
    report,
    prisma,
    zones,
    alive,
    members,
    characters,
    liveRoles,
    memberList,
    spectators,
    locations,
    liveLocationChannels,
    rolesById,
  });

  // --- full: overwrites + threads --------------------------------------

  if (scope === "full") {
    const characterUserIds = new Set(characters.map((c) => c.discordUserId));

    await runOverwritesSweep({ report, errors, zones, locations, spectators, zoneRoleIds, zoneGmRoleIds });
    await runThreadsSweep({ report, errors, prisma, alive, characters, characterUserIds });
    await runNarrowcastSweep({ report, errors, prisma, alive, config, characterUserIds });
    await runTurnsAccessSweep({ report, errors, prisma, liveRoles, zoneRoleIds, spectators });
  }

  const failures = [
    ...errors,
    ...findings.filter((f) => f.error).map((f) => ({ check: f.check, target: f.target, message: f.error })),
  ];
  const summaryCounts = {};
  for (const f of findings) summaryCounts[f.check] = (summaryCounts[f.check] ?? 0) + 1;

  const result = {
    scope,
    apply,
    findings,
    failures,
    repaired: findings.filter((f) => f.repaired).length,
  };

  await prisma.systemReport
    .create({
      data: {
        kind: "DOCTOR",
        startedAt,
        finishedAt: new Date(),
        ok: failures.length === 0,
        actorDiscordUserId,
        summary: {
          scope,
          apply,
          findings: findings.length,
          repaired: result.repaired,
          byCheck: summaryCounts,
        },
        failures: [
          ...failures,
          ...findings
            .filter((f) => !f.repaired && !f.error)
            .map((f) => ({ check: f.check, target: f.target, message: f.problem })),
        ],
      },
    })
    .catch((err) => console.error("Channel doctor: report write failed:", err.message));

  return result;
}

module.exports = { runChannelDoctor };
