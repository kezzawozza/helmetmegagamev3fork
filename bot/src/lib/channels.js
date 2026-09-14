const { ChannelType } = require("discord.js");
const { prisma, SPECIAL_CHANNELS } = require("@lifeweb/db");

// Tupper/summary status is channel-ID-based — a channel opts in by being a zone's #summary, a
// Location's own channel, or a special channel (db/lib/specialChannels.js, tupper-only never summary).
let channelIds = { tupperSummary: new Set(), tupperOnly: new Set() }; // refreshed every 5 min

let locationChannelIds = new Set(); // subset of tupperOnly that is a LOCATION channel

let channelContexts = new Map(); // channelId -> { zoneId, zoneName, locationId, locationName, channelKind }

async function refreshLocationChannels() {
  const [zones, locations, config] = await Promise.all([
    prisma.zone.findMany({ select: { id: true, name: true, discordSummaryChannelId: true } }),
    prisma.location.findMany({
      select: {
        id: true,
        name: true,
        zoneId: true,
        discordChannelId: true,
        zone: { select: { name: true } },
      },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const tupperSummary = new Set();
  const tupperOnly = new Set();
  const locationOnly = new Set();
  const contexts = new Map();
  const nowhere = { zoneId: null, zoneName: null, locationId: null, locationName: null };
  const note = (channelId, context) => {
    if (channelId) contexts.set(channelId, context);
  };

  for (const zone of zones) {
    if (!zone.discordSummaryChannelId) continue;
    tupperSummary.add(zone.discordSummaryChannelId);
    note(zone.discordSummaryChannelId, {
      ...nowhere,
      zoneId: zone.id,
      zoneName: zone.name,
      channelKind: "summary",
    });
  }
  for (const location of locations) {
    if (!location.discordChannelId) continue;
    tupperOnly.add(location.discordChannelId);
    locationOnly.add(location.discordChannelId);
    note(location.discordChannelId, {
      zoneId: location.zoneId,
      zoneName: location.zone?.name ?? null,
      locationId: location.id,
      locationName: location.name,
      channelKind: "location",
    });
  }
  for (const entry of SPECIAL_CHANNELS) {
    const channelId = config?.[entry.configKey];
    if (!channelId) continue;
    if (entry.tupper) tupperOnly.add(channelId);
    note(channelId, { ...nowhere, channelKind: entry.slug });
  }

  channelIds = { tupperSummary, tupperOnly };
  locationChannelIds = locationOnly;
  channelContexts = contexts;
}

// A Room thread or Conversation reports the thread as its channel, so place comes from the parent.
function resolveChannelContext(channel) {
  const isThread = typeof channel.isThread === "function" && channel.isThread();
  const parentId = isThread ? channel.parent?.id : channel.id;
  const context = parentId ? channelContexts.get(parentId) : null;
  return {
    zoneId: context?.zoneId ?? null,
    zoneName: context?.zoneName ?? null,
    locationId: context?.locationId ?? null,
    locationName: context?.locationName ?? null,
    channelKind: context?.channelKind ?? null,
    threadName: isThread ? (channel.name ?? null) : null,
    discordChannelId: channel.id ?? null, // jump-link id; snapshotted by the archive writer, no FK
  };
}
setInterval(() => refreshLocationChannels().catch((err) => console.error("Failed to refresh location channels:", err)), 5 * 60_000);

function isSummaryChannel(channel) {
  if (channel.type !== ChannelType.GuildText) return false;
  return channelIds.tupperSummary.has(channel.id);
}

function isTupperChannel(channel) {
  if (channel.type !== ChannelType.GuildText) return false;
  return channelIds.tupperSummary.has(channel.id) || channelIds.tupperOnly.has(channel.id);
}

// A thread reports itself as message.channel, so proxying checks the parent's ID instead. A
// top-level LOCATION channel is deliberately not one: it's street scenery with no Send.
function isDesignatedTupperChannel(channel) {
  if (isSummaryChannel(channel)) return true;
  if (channel.isThread() && channel.parent) {
    return channelIds.tupperSummary.has(channel.parent.id) || channelIds.tupperOnly.has(channel.parent.id);
  }
  if (channel.type !== ChannelType.GuildText) return false;
  return channelIds.tupperOnly.has(channel.id) && !locationChannelIds.has(channel.id);
}

module.exports = {
  isSummaryChannel,
  isTupperChannel,
  isDesignatedTupperChannel,
  refreshLocationChannels,
  resolveChannelContext,
};
