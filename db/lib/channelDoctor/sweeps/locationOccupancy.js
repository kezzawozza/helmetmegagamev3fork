const { putChannelOverwrite, deleteChannelOverwrite } = require("../../discordRest");
const { LOCATION_MEMBER_ALLOW } = require("../../zoneChannelSpec");

// The channel doctor's `location-occupancy` check — the per-member overwrites on a Location channel must be exactly the living characters standing there. It is the ONLY sweep that catches a location grant the move pipeline failed to swap.
// Costs no extra requests: the overwrites arrive on the channel object the structure pass above already fetched. Member targets only (type 1) — role overwrites belong to locationChannelSpec and are reconciled by the full pass, not here.
async function runLocationOccupancySweep({ report, locations, liveLocationChannels, alive }) {
  for (const location of locations) {
    const live = liveLocationChannels.get(location.id);
    if (!live) continue;
    const label = `${location.zoneName}/${location.name}`;
    const shouldHave = new Set(
      alive
        .filter((c) => c.locationId === location.id && !c.webOnly)
        .map((c) => c.discordUserId)
        .filter(Boolean),
    );
    // The ALLOW BITS come along, not just the id — LOCATION_MEMBER_ALLOW changes over time, and an occupant holding an old overwrite would otherwise pass a presence-only check forever.
    const has = new Map(
      (live.permission_overwrites ?? [])
        .filter((o) => Number(o.type) === 1)
        .map((o) => [o.id, String(o.allow ?? "0")]),
    );
    const wantAllow = String(LOCATION_MEMBER_ALLOW);

    for (const userId of shouldHave) {
      const allow = has.get(userId);
      if (allow === wantAllow) continue;
      const why =
        allow === undefined
          ? `${userId} stands here but the channel is closed to them`
          : `${userId} holds the old permissions here (${allow}, want ${wantAllow})`;
      await report("location-occupancy", label, why, () =>
        putChannelOverwrite(location.discordChannelId, userId, {
          allow: wantAllow,
          type: 1,
        }),
      );
    }
    for (const userId of has.keys()) {
      if (shouldHave.has(userId)) continue;
      await report("location-occupancy", label, `${userId} can read this channel but does not stand here`, () =>
        deleteChannelOverwrite(location.discordChannelId, userId),
      );
    }
  }
}

module.exports = { runLocationOccupancySweep };
