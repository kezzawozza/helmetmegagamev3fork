// The channel doctor's "cheap: role membership" sweep — zone role
// membership, location occupancy (its own module, called here to keep the
// original sequence), turn-ping, the Deadchat seat, character-role
// orphans, seat stamping, and spectator visibility. Moved verbatim out of
// runChannelDoctor (W2d).
const { getGuildChannels, deleteGuildRole } = require("../../discordRest");
const { ghostUserIds } = require("../../ghost");
const { deadchatSeatHolders, openDeadchatTo, closeDeadchatTo } = require("../../deadchat");
const { managedSpectatorChannels, spectatorDrift, applySpectatorOverwrite } = require("../../spectatorAccess");
const { looksLikeCharacterRole, standingRoleIds, reconcileRoleMembership } = require("../shared");
const { runLocationOccupancySweep } = require("./locationOccupancy");

async function runRoleMembershipSweep({
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
}) {
  // Zone roles: exactly the living characters standing in each zone.
  for (const zone of zones) {
    if (!zone.discordRoleId) continue;
    await reconcileRoleMembership({
      roleId: zone.discordRoleId,
      label: `Zone: ${zone.name}`,
      // A "web only" character holds no Discord access at all, so they are
      // not in this set and the doctor takes the role back off them if they
      // somehow still wear it (docs/systemdocs/CHAT.md §6).
      shouldHave: alive.filter((c) => c.zoneId === zone.id && !c.webOnly).map((c) => c.discordUserId),
      members,
      report,
    });
  }

  await runLocationOccupancySweep({ report, prisma, locations, liveLocationChannels, alive });

  // Turn-ping: living characters' preferences, nobody else — and not a
  // web-only one. The ping is a <@&role> inside the #turns console, and
  // #turns is opened by the zone role that the web-only switch takes away
  // (db/lib/turnsChannelAccess.js), so holding the role there meant being
  // pinged twice a day about a channel you cannot open. Bidirectional, like
  // every reconcile here, which is what makes this one predicate both take
  // the role off everybody already in that state and hand it back the moment
  // they switch web-only off again.
  await reconcileRoleMembership({
    roleId: process.env.DISCORD_TURN_PING_ROLE_ID,
    label: "turn-ping",
    shouldHave: alive.filter((c) => c.turnPingOptIn && !c.webOnly).map((c) => c.discordUserId),
    members,
    report,
  });

  // The Deadchat seat: whoever db/lib/ghost.js says is a ghost, and nobody else. Per-member
  // overwrites on one channel (db/lib/deadchat.js), not a role — the Ghost role this replaces
  // printed "dead" on a profile card to anyone who clicked.
  //
  // BIDIRECTIONAL, which inverts what the old ghost reconcile did on purpose. That one was
  // database -> role only, on the argument that the role was a cache of a derived set and decided
  // nothing, so drift cost a dead player some channels and nothing more. Here the overwrite IS the
  // access, and drift the other way is a living player sitting in the dead's room reading it. So
  // both directions are swept, and a seat nobody should hold is taken back.
  //
  // A departed member keeps neither: they are not in `members`, so the add arm skips them, and the
  // remove arm below takes the seat off anyone the database does not name — which is the cleanup
  // path for somebody who left the guild mid-death.
  await reconcileDeadchatSeats({ prisma, characters, members, report });

  // Character roles: every ALIVE character's role exists; no orphan
  // character-signature roles. Creation isn't repaired here (it needs the
  // name/color pipeline in web/lib/discordGuild.js) — report only. Orphans
  // are deleted on apply, same conservatism as prune-orphan-roles.
  const claimedRoleIds = new Set(characters.map((c) => c.discordRoleId).filter(Boolean));
  const standing = standingRoleIds();
  // The zone ACCESS roles. Kept narrow on purpose: this same set is what
  // #turns grants view to below, and a GM seat has no business there — every
  // GM already holds a global GM role, which #turns grants outright.
  const zoneRoleIds = new Set(zones.map((z) => z.discordRoleId).filter(Boolean));
  // The per-zone GM seats. Not character roles, so the orphan sweep below
  // must never offer to delete one; nothing else wants them.
  const zoneGmRoleIds = new Set(zones.map((z) => z.gmRoleId).filter(Boolean));
  for (const c of alive) {
    if (!c.discordRoleId) {
      await report("character-role", c.name, "living character has no Discord role recorded");
    } else if (!rolesById.has(c.discordRoleId)) {
      await report("character-role", c.name, "recorded character role no longer exists");
    }
  }
  for (const role of liveRoles) {
    if (
      claimedRoleIds.has(role.id) ||
      standing.has(role.id) ||
      zoneRoleIds.has(role.id) ||
      zoneGmRoleIds.has(role.id)
    ) {
      continue;
    }
    if (!looksLikeCharacterRole(role)) continue;
    if (role.managed || role.permissions !== "0") continue;
    const held = memberList.some((m) => m.roles.includes(role.id));
    if (held) continue;
    await report("character-role", role.name, "orphan character role (no character claims it)", () =>
      deleteGuildRole(role.id),
    );
  }

  // Seat stamping: nothing seat-scoped may point at a cave level.
  const badSeatZones = zones.filter((z) => z.kind === "CAVE_LEVEL").map((z) => z.id);
  if (badSeatZones.length > 0) {
    const [actions, notes] = await Promise.all([
      prisma.action.count({ where: { zoneId: { in: badSeatZones } } }),
      prisma.note.count({ where: { zoneId: { in: badSeatZones } } }),
    ]);
    if (actions > 0 || notes > 0) {
      await report(
        "seat-stamp",
        "Action/Note",
        `${actions + notes} rows stamped with a cave-level zoneId instead of the Caves seat`,
      );
    }
  }

  // The spectator seat's visibility on every managed channel — the backstop
  // for a phase transition whose sweep died. One channel list, PUTs only on
  // drift, so it stays in the cheap scope.
  {
    const [managedSpectator, liveChannels] = await Promise.all([
      managedSpectatorChannels(prisma),
      getGuildChannels(),
    ]);
    for (const target of spectatorDrift(managedSpectator, liveChannels, spectators)) {
      await report(
        "spectator-visibility",
        target.label,
        spectators ? "spectators cannot see a channel they should" : "spectators can see a channel while the game is not on",
        () => applySpectatorOverwrite(target.id, { visible: spectators }),
      );
    }
  }

  return { zoneRoleIds, zoneGmRoleIds };
}

// Discord allows 1000 overwrites on a channel. Deadchat's population is the players who have died
// and not re-rolled — tens, realistically — but the failure is silent, so it is reported well before
// it is fatal rather than discovered as a refused write.
const SEAT_WARN_AT = 800;

async function reconcileDeadchatSeats({ prisma, characters, members, report }) {
  let held;
  try {
    held = await deadchatSeatHolders(prisma);
  } catch (err) {
    await report("deadchat-seat", "channel", `couldn't read the Deadchat channel: ${err.message ?? err}`);
    return;
  }
  // No channel provisioned yet is not drift — db:sync-deadchat has simply not run.
  if (held.length === 0) {
    const { deadchatChannelId } = require("../../deadchat");
    if (!(await deadchatChannelId(prisma))) return;
  }

  if (held.length >= SEAT_WARN_AT) {
    await report("deadchat-seat", "channel", `${held.length} seats, approaching Discord's 1000-overwrite cap`);
  }

  const want = ghostUserIds(characters);
  const has = new Set(held);

  for (const userId of want) {
    if (has.has(userId)) continue;
    if (!members.get(userId)) continue; // left the guild — the character checks report that
    await report("deadchat-seat", userId, "a ghost with no Deadchat seat", () =>
      openDeadchatTo(prisma, userId),
    );
  }
  for (const userId of has) {
    if (want.has(userId)) continue;
    await report("deadchat-seat", userId, "holds a Deadchat seat and shouldn't", () =>
      closeDeadchatTo(prisma, userId),
    );
  }
}

module.exports = { runRoleMembershipSweep };
