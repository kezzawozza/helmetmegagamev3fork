// Where a staged PUBLIC declaration goes: a SURFACE zone posts to its #summary; a CAVE_LEVEL zone (no #summary, CHANNELS.md §2) posts into EVERY
// Location channel in the level. One source of truth for the push, Resend and delivery callers (ADJUDICATION.md §1a). Takes `prisma`, off the @lifeweb/db barrel.

// `publicKey` becomes the tail of Delivery.dedupeKey (deliveryKeyFor reads that exact field name) — get it wrong and skipDuplicates collapses every
// target into ONE row. A Location target is keyed by the LOCATION, never its channel id, since syncZones.js/channelDoctor.js rewrite it on reprovision.
function publicTargetsFor({ zone, locations = [] } = {}) {
  if (!zone) return [];

  if (zone.kind === "CAVE_LEVEL") {
    return locations
      .filter((location) => location?.discordChannelId)
      .map((location) => ({
        publicKey: `public:loc:${location.id}`,
        channelId: location.discordChannelId,
        name: location.name,
      }));
  }

  // CAVE_GROUP has no summary — empty list. `name` stays NULL: stagedFormat.js#deliveryNotes renders `d.name ?? "the channel"`.
  if (!zone.discordSummaryChannelId) return [];
  return [{ publicKey: "public", channelId: zone.discordSummaryChannelId, name: null }];
}

async function publicPostTargets(prisma, zoneId) {
  if (!zoneId) return { zone: null, targets: [] };

  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: { id: true, name: true, kind: true, discordSummaryChannelId: true },
  });
  if (!zone) return { zone: null, targets: [] };

  const locations =
    zone.kind === "CAVE_LEVEL"
      ? await prisma.location.findMany({
          where: { zoneId: zone.id, discordChannelId: { not: null } },
          // Same ordering as worldBroadcast.js#ambientEverywhere.
          orderBy: { name: "asc" },
          select: { id: true, name: true, discordChannelId: true },
        })
      : [];

  return { zone, targets: publicTargetsFor({ zone, locations }) };
}

module.exports = { publicTargetsFor, publicPostTargets };
