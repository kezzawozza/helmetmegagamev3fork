// The per-member half of a mirror run — see index.js's header for the
// OBJECTS/PEOPLE split. The sweep order (structure, roles and occupancy, then
// the expensive halves) is the order channelDoctor.js always ran them in.
const { getGuildRoles, listGuildMembers } = require("../discordRest");
const { CURSE_SELECT } = require("../curse");
const { spectatorsVisible } = require("../spectatorAccess");
const { gmRoleIdFor } = require("../zoneChannelSpec");
const { runStructureSweep } = require("../channelDoctor/sweeps/structure");
const { runRoleMembershipSweep } = require("../channelDoctor/sweeps/roles");
const { runOverwritesSweep } = require("../channelDoctor/sweeps/overwrites");
const { runThreadsSweep } = require("../channelDoctor/sweeps/threads");
const { runNarrowcastSweep } = require("../channelDoctor/sweeps/narrowcast");
const { runTurnsAccessSweep } = require("../channelDoctor/sweeps/turnsAccess");
const {
  accountRowsFromMembers,
  planDiscordAccountSync,
  applyDiscordAccountSync,
} = require("../discordAccounts");

// `scope` decides how much of this runs: "structure" none of it, "cheap" the
// first two, "full" all six.
async function runSweeps(prisma, { scope, report, errors, live }) {
  if (scope !== "cheap" && scope !== "full") return;

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
        discordMirrored: true,
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

  // The Location channel objects the occupancy check diffs against. They come
  // off the run's ONE guild snapshot now: GET /guilds/:id/channels returns each
  // channel's permission_overwrites, so the doctor's old per-Location getChannel
  // — one REST call per Location, every restart and every turn — buys nothing.
  const liveLocationChannels = new Map();
  for (const location of locations) {
    const channel = location.discordChannelId ? live.channelsById.get(location.discordChannelId) : null;
    if (channel) liveLocationChannels.set(location.id, channel);
  }

  // --- cheap: the handle cache -----------------------------------------

  // Free: `memberList` is already in hand above, and the plan reads before it
  // writes, so a guild where nobody renamed themselves costs one indexed query.
  // Planned and repaired separately so a dry run stays a dry run. Never fails
  // the run — a stale handle is a search miss, not broken Discord.
  try {
    const plan = await planDiscordAccountSync(prisma, accountRowsFromMembers(memberList));
    const drifted = plan.toCreate.length + plan.toUpdate.length;
    if (drifted > 0) {
      await report(
        "discord-handles",
        `${drifted} account(s)`,
        `${plan.toCreate.length} handle(s) never cached, ${plan.toUpdate.length} renamed`,
        () => applyDiscordAccountSync(prisma, plan),
      );
    }
  } catch (err) {
    errors.push(`Discord handle cache failed: ${err.message}`);
  }

  // --- cheap: structure ------------------------------------------------

  await runStructureSweep({ report, prisma, zones, locations, rolesById, members, alive, locationsById });

  // --- cheap: role membership -----------------------------------------

  const { zoneRoleIds } = await runRoleMembershipSweep({
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

    await runOverwritesSweep({ report, errors, zones, spectators });
    await runThreadsSweep({ report, errors, prisma, alive, characters, characterUserIds });
    await runNarrowcastSweep({ report, errors, prisma, alive, config, characterUserIds });
    await runTurnsAccessSweep({ report, errors, prisma, liveRoles, zoneRoleIds, spectators });
  }
}

module.exports = { runSweeps };
