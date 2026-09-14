// Strips everything that grants sight of the game — zone role plus every
// per-member channel overwrite. Used on death, guildMemberRemove, and in bulk
// by Restart Game. A Location wears no Discord role, so this overwrite sweep
// is the only thing taking a dead character's sight of their room away (the
// doctor's occupancy check is the safety net). BOTH functions read-then-delete
// (removing only what's really there, not a blind double-DELETE per channel)
// and fall back to a blind sweep if the read fails, and return counts/failure
// lists rather than nothing — silently skipping leaves a departed player still
// reading rooms. Takes `prisma` as the first param; deliberately NOT on the
// @lifeweb/db barrel — require it by path.
const {
  deleteChannelOverwrite,
  getChannel,
  getGuildChannels,
  getGuildMember,
  removeMemberRole,
  listGuildMembers,
} = require("./discordRest");
const { SPECIAL_CHANNELS } = require("./specialChannels");

function zoneChannelIds(zone) {
  if (!zone) return [];
  return [
    zone.discordCategoryId,
    zone.discordSummaryChannelId,
    ...(zone.locations ?? []).map((l) => l.discordChannelId),
  ].filter(Boolean);
}

async function allAccessChannelIds(prisma) {
  const [zones, config] = await Promise.all([
    prisma.zone.findMany({
      select: {
        discordCategoryId: true,
        discordSummaryChannelId: true,
        locations: { select: { discordChannelId: true } },
      },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const channelIds = zones.flatMap(zoneChannelIds);
  for (const entry of SPECIAL_CHANNELS) channelIds.push(config?.[entry.configKey]);
  return channelIds.filter(Boolean);
}

// One character's full revoke: held zone roles stripped, then member
// overwrites removed from whichever channels actually carry one. `keepGuests`
// leaves RoomGuest rows alone — the web-only switch (CHAT.md §6) wants this,
// since it strips only Discord access and a guest row is still game state.
async function revokeAllCharacterAccess(prisma, character, { keepGuests = false } = {}) {
  const targetIds = [character.discordUserId, character.discordRoleId].filter(Boolean);
  const failures = [];
  let attempted = 0;

  // Rows first, so a Discord failure below can't leave a grant readmitting a corpse.
  if (!keepGuests) {
    await prisma.roomGuest
      .deleteMany({ where: { characterId: character.id } })
      .catch((err) => console.error(`Room guest revoke for ${character.id} failed:`, err.message ?? err));
  }

  const strip = async (label, fn) => {
    attempted += 1;
    try {
      await fn();
    } catch (err) {
      failures.push({ target: label, message: err.message });
    }
  };

  if (character.discordUserId) {
    const zoneRoles = await prisma.zone.findMany({
      where: { discordRoleId: { not: null } },
      select: { discordRoleId: true, name: true },
    });

    // A throw falls back to removing all roles blind — a no-op is harmless, skipping isn't.
    let held = null;
    try {
      const member = await getGuildMember(character.discordUserId);
      held = member ? new Set(member.roles ?? []) : new Set(); // null member already left
    } catch (err) {
      console.error(
        `Access revoke for ${character.name ?? character.id}: couldn't read the member, ` +
          `stripping every zone role blind instead:`,
        err.message,
      );
    }

    for (const row of zoneRoles) {
      if (held && !held.has(row.discordRoleId)) continue;
      await strip(`access role ${row.name}`, () => removeMemberRole(character.discordUserId, row.discordRoleId));
    }
  }

  if (targetIds.length > 0) {
    const channelIds = await allAccessChannelIds(prisma);

    // GET /guilds/{id}/channels carries each channel's permission_overwrites,
    // so one call is the whole picture (threads excluded, but not needed here).
    let live = null;
    try {
      const channels = await getGuildChannels();
      live = new Map(channels.map((c) => [c.id, c.permission_overwrites ?? []]));
    } catch (err) {
      console.error(
        `Access revoke for ${character.name ?? character.id}: couldn't list guild channels, ` +
          `sweeping every access channel blind instead:`,
        err.message,
      );
    }

    for (const channelId of channelIds) {
      const present = live ? live.get(channelId) : null; // missing = deleted by hand, ordinary
      if (live && !present) continue;
      for (const targetId of targetIds) {
        if (present && !present.some((o) => o.id === targetId)) continue;
        // allow404 already makes "no overwrite" return null; anything reaching catch is a real failure.
        await strip(`${channelId}/${targetId}`, () => deleteChannelOverwrite(channelId, targetId));
      }
    }
  }

  if (failures.length > 0) {
    console.error(
      `Access revoke for ${character.name ?? character.id}: ${failures.length} of ${attempted} ` +
        `revocations FAILED. They may still read those rooms. First: ${failures[0].message}`,
    );
  }
  return { attempted, failed: failures.length, failures };
}

// The same revoke for MANY characters at once — Restart Game. Bulk-shaped,
// not per-character: (1) one paginated member-list read, then one removal per
// held zone role; (2) channel-major overwrite sweep, deleting only present
// overwrites belonging to the roster — same read-then-delete shape as the
// sync's reconcile, keeping a full-roster wipe to hundreds of calls instead of
// tens of thousands. Sequential throughout (ARCHITECTURE.md §5).
async function revokeAccessForCharacters(prisma, characters) {
  const targetIds = new Set();
  for (const character of characters ?? []) {
    if (character.discordUserId) targetIds.add(character.discordUserId);
    if (character.discordRoleId) targetIds.add(character.discordRoleId);
  }
  if (targetIds.size === 0) return { channels: 0, removed: 0, rolesRemoved: 0, failed: 0, unreadable: 0 };

  const characterIds = (characters ?? []).map((c) => c.id).filter(Boolean);
  if (characterIds.length > 0) {
    await prisma.roomGuest
      .deleteMany({ where: { characterId: { in: characterIds } } })
      .catch((err) => console.error("Access revoke: room guest sweep failed:", err.message ?? err));
  }

  let rolesRemoved = 0;
  let failed = 0;

  const zoneRoles = await prisma.zone.findMany({
    where: { discordRoleId: { not: null } },
    select: { discordRoleId: true },
  });
  const zoneRoleIds = new Set(zoneRoles.map((z) => z.discordRoleId));
  if (zoneRoleIds.size > 0) {
    try {
      const members = await listGuildMembers();
      for (const member of members) {
        if (!targetIds.has(member.user.id)) continue;
        for (const roleId of member.roles) {
          if (!zoneRoleIds.has(roleId)) continue;
          try {
            await removeMemberRole(member.user.id, roleId);
            rolesRemoved += 1;
          } catch (err) {
            failed += 1;
            console.error(`Access revoke: failed to strip zone role from ${member.user.id}:`, err.message);
          }
        }
      }
    } catch (err) {
      failed += 1;
      console.error("Access revoke: couldn't list guild members, zone roles were not stripped:", err.message);
    }
  }

  let removed = 0;
  let unreadable = 0;
  const visited = await allAccessChannelIds(prisma);
  for (const channelId of visited) {
    // allow404 returns null for a channel deleted by hand — ordinary. A THROW
    // means the read failed; treating that as "no such channel" would quietly skip its overwrites.
    let live;
    try {
      live = await getChannel(channelId, { allow404: true });
    } catch (err) {
      unreadable += 1;
      console.error(`Access revoke: couldn't read channel ${channelId}, its overwrites are untouched:`, err.message);
      continue;
    }
    if (!live) continue;

    for (const overwrite of live.permission_overwrites ?? []) {
      if (!targetIds.has(overwrite.id)) continue;
      try {
        await deleteChannelOverwrite(channelId, overwrite.id);
        removed += 1;
      } catch (err) {
        failed += 1;
        console.error(`Access revoke: failed to remove ${overwrite.id} from ${channelId}:`, err.message);
      }
    }
  }

  if (failed > 0 || unreadable > 0) {
    console.error(
      `Access revoke finished with ${failed} failures and ${unreadable} unreadable channels. ` +
        `Some access may still be live — the channel doctor's next pass reconciles it.`,
    );
  }

  return { channels: visited.length, removed, rolesRemoved, failed, unreadable };
}

module.exports = {
  zoneChannelIds,
  revokeAllCharacterAccess,
  revokeAccessForCharacters,
};
