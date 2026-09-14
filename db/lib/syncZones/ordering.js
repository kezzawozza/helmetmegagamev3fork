// syncZones Ordering: keeps Discord category and channel positions matching
// the YAML's sortOrder. Split out of db/lib/syncZones.js — see that file.
const { getGuildChannels, patchChannel, patchGuildChannelPositions } = require("../discordRest");
const { CHANNEL_TYPE_CATEGORY } = require("./shared");

// Cave levels share one category, so their location channels interleave
// there: level.sortOrder * this + location.sortOrder.
const LEVEL_CHANNEL_STRIDE = 10;

// --- Ordering ----------------------------------------------------------

async function sortZoneCategories(prisma) {
  const zones = await prisma.zone.findMany({ where: { discordCategoryId: { not: null } } });
  if (zones.length === 0) return;

  const channels = await getGuildChannels();
  const categoryIds = new Set(zones.map((z) => z.discordCategoryId));
  const currentPositions = channels
    .filter((c) => c.type === CHANNEL_TYPE_CATEGORY && categoryIds.has(c.id))
    .map((c) => c.position)
    .sort((a, b) => a - b);

  const sorted = [...zones].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
  const updates = sorted
    .map((z, i) => ({ id: z.discordCategoryId, position: currentPositions[i] }))
    .filter((u) => Number.isInteger(u.position));

  if (updates.length > 0) await patchGuildChannelPositions(updates);
}

// Per surface zone: #summary then its location channels in sortOrder, under
// the zone's category. Per cave level: its location channels under the
// group's category, offset by level. `parent_id` must NOT ride along in the
// bulk position PATCH (Discord 400 code 40009 — reparenting is one channel
// at a time), so drifted channels are repaired separately first.
async function sortZoneChannels(prisma) {
  const zones = await prisma.zone.findMany({
    orderBy: { sortOrder: "asc" },
    include: { locations: { orderBy: { sortOrder: "asc" } } },
  });

  const intended = [];
  for (const zone of zones) {
    if (zone.kind === "SURFACE") {
      let position = 0;
      if (zone.discordSummaryChannelId) {
        intended.push({ id: zone.discordSummaryChannelId, position: position++, parentId: zone.discordCategoryId });
      }
      for (const location of zone.locations) {
        if (location.discordChannelId) {
          intended.push({ id: location.discordChannelId, position: position++, parentId: zone.discordCategoryId });
        }
      }
    } else if (zone.kind === "CAVE_LEVEL") {
      const parent = zones.find((z) => z.id === zone.parentZoneId);
      zone.locations.forEach((location, offset) => {
        if (location.discordChannelId) {
          intended.push({
            id: location.discordChannelId,
            position: zone.sortOrder * LEVEL_CHANNEL_STRIDE + offset,
            parentId: parent?.discordCategoryId ?? null,
          });
        }
      });
    }
  }
  if (intended.length === 0) return { ordered: 0, reparented: [] };

  const live = new Map((await getGuildChannels()).map((c) => [c.id, c]));
  const reparented = [];
  for (const { id, parentId } of intended) {
    const current = live.get(id);
    if (!current || !parentId || current.parent_id === parentId) continue;
    await patchChannel(id, { parent_id: parentId });
    reparented.push(id);
  }

  await patchGuildChannelPositions(intended.map(({ id, position }) => ({ id, position })));
  return { ordered: intended.length, reparented };
}

module.exports = {
  sortZoneCategories,
  sortZoneChannels,
};
