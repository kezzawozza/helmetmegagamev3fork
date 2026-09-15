// Who can see #turns. The gate is the zone role (db/lib/specialChannels.js, `roleViewZones`): every living character holds exactly one "Zone: X" role, so @everyone is denied the view and every zone role is allowed it.
// SendMessages stays denied to @everyone — the buttons are components, not messages. Applied idempotently from bot/src/lib/turnsConsole.js, db/lib/syncZones.js, and db/lib/channelDoctor.js.
const {
  getGuildChannels,
  getGuildRoles,
  getChannel,
  putChannelOverwrite,
  deleteChannelOverwrite,
} = require("./discordRest");
const { applySpectatorOverwrite, spectatorOverwrite, spectatorsVisibleNow } = require("./spectatorAccess");
const { SPECTATOR_ROLE_ID, gmRoleIds } = require("./roleIds");

const CHANNEL_TYPE_TEXT = 0;

const PERM_VIEW_CHANNEL = 1024n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ATTACH_FILES = 32768n;

const EVERYONE_DENY = PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES;
const GM_ALLOW = PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES;

// The canonical exact-name match — there is only ever meant to be one #turns; works on a raw REST channel and a discord.js gateway channel alike, since ChannelType.GuildText is 0.
function isTurnsChannel(channel) {
  return channel?.type === CHANNEL_TYPE_TEXT && channel.name?.toLowerCase() === "turns";
}

// The intended overwrite set, as a Map keyed on target id — what the channel doctor compares the live channel against.
function turnsChannelOverwrites({ guildId, zoneRoleIds, spectators = true }) {
  const wanted = new Map();
  if (guildId) wanted.set(guildId, { id: guildId, type: 0, allow: "0", deny: EVERYONE_DENY.toString() });
  for (const id of gmRoleIds()) {
    wanted.set(id, { id, type: 0, allow: GM_ALLOW.toString(), deny: "0" });
  }
  // Phase-gated: view only while the game is on (db/lib/spectatorAccess.js).
  wanted.set(SPECTATOR_ROLE_ID, spectatorOverwrite({ visible: spectators })[0]);
  // No ghost seat here any more. A ghost has no Discord presence at all now except Deadchat
  // (db/lib/deadchat.js) — the strip pass below takes the old overwrite off on the next run.
  for (const roleId of zoneRoleIds) {
    if (!roleId || wanted.has(roleId)) continue;
    wanted.set(roleId, { id: roleId, type: 0, allow: PERM_VIEW_CHANNEL.toString(), deny: "0" });
  }
  return wanted;
}

// Resolves #turns by name. Returns null when the guild has none — already reported loudly by ensureTurnsConsole.
async function findTurnsChannelId() {
  const channels = await getGuildChannels();
  return channels.find(isTurnsChannel)?.id ?? null;
}

async function zoneRoleIdsFor(prisma) {
  const zones = await prisma.zone.findMany({
    where: { discordRoleId: { not: null } },
    select: { discordRoleId: true },
  });
  return zones.map((z) => z.discordRoleId);
}

// Idempotent, safe to re-run. Single-target PUTs throughout rather than a PATCH of the whole array, so this never clobbers an overwrite it does not own.
async function syncTurnsChannelAccess(prisma, { channelId = null } = {}) {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || !process.env.DISCORD_TOKEN) return { ok: false, reason: "unconfigured" };

  const id = channelId ?? (await findTurnsChannelId());
  if (!id) return { ok: false, reason: "missing" };

  await putChannelOverwrite(id, guildId, { deny: EVERYONE_DENY.toString() });
  for (const gmRoleId of gmRoleIds()) {
    await putChannelOverwrite(id, gmRoleId, { allow: GM_ALLOW.toString() });
  }
  await applySpectatorOverwrite(id, { visible: await spectatorsVisibleNow(prisma) });

  const zoneRoleIds = await zoneRoleIdsFor(prisma);
  let roleGrants = 0;
  for (const roleId of zoneRoleIds) {
    // A GM seat already has GM_ALLOW above; re-granting it the plain view bit here would narrow it.
    if (gmRoleIds().includes(roleId) || roleId === SPECTATOR_ROLE_ID) continue;
    await putChannelOverwrite(id, roleId, { allow: PERM_VIEW_CHANNEL.toString() });
    roleGrants += 1;
  }

  // Strip everything this spec does not name. The set above is the COMPLETE description of who may see #turns, the way zoneChannelSpec.js is for a zone channel — anything else is a leftover from the hand-managed era.
  const wanted = turnsChannelOverwrites({ guildId, zoneRoleIds });
  const botRoleIds = new Set(
    (await getGuildRoles().catch(() => [])).filter((r) => r.tags?.bot_id).map((r) => r.id),
  );
  let stripped = 0;
  const live = await getChannel(id, { allow404: true }).catch(() => null);
  for (const overwrite of live?.permission_overwrites ?? []) {
    if (wanted.has(overwrite.id)) continue;
    // Never touch a bot's own overwrite — a guild where ours isn't Administrator would lose the channel it posts to.
    if (botRoleIds.has(overwrite.id)) continue;
    await deleteChannelOverwrite(id, overwrite.id).catch(() => {});
    stripped += 1;
  }

  return { ok: true, channelId: id, roleGrants, stripped };
}

module.exports = {
  isTurnsChannel,
  findTurnsChannelId,
  turnsChannelOverwrites,
  syncTurnsChannelAccess,
};
