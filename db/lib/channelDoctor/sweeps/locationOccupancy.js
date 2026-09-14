const { putChannelOverwrite, deleteChannelOverwrite } = require("../../discordRest");
const { LOCATION_MEMBER_ALLOW, LOCATION_VANTAGE_ALLOW, LOCATION_VANTAGE_DENY } = require("../../zoneChannelSpec");
const { allVantages } = require("../../vantages");

// The channel doctor's `location-occupancy` check — the per-member overwrites on a Location channel must be exactly the living characters standing there, plus the ones still watching it (db/lib/vantages.js), each with the right allow AND deny masks. It is the ONLY sweep that catches a location grant the move pipeline failed to swap.
// Costs one extra query and no extra requests: the overwrites arrive on the channel object the structure pass above already fetched. Member targets only (type 1) — role overwrites belong to locationChannelSpec and are reconciled by the full pass, not here.
// This is also the backstop for the turn shift. A vantage row is invalid to allVantages() the moment its turn is no longer open, so the sweep that runs at the end of every turn advance closes whatever the expiry step missed.

const STANDING = { allow: String(LOCATION_MEMBER_ALLOW), deny: "0" };
const WATCHING = { allow: String(LOCATION_VANTAGE_ALLOW), deny: String(LOCATION_VANTAGE_DENY) };

async function runLocationOccupancySweep({ report, prisma, locations, liveLocationChannels, alive }) {
  // One query for the whole game, already filtered to rows that are still
  // valid — the right turn, and a zone the character is actually in.
  const watching = new Map(); // locationId -> Set(discordUserId)
  const aliveById = new Map((alive ?? []).map((c) => [c.id, c]));
  const vantages = prisma ? await allVantages(prisma, alive).catch(() => []) : [];
  for (const row of vantages) {
    const discordUserId = aliveById.get(row.characterId)?.discordUserId;
    if (!discordUserId) continue;
    if (!watching.has(row.locationId)) watching.set(row.locationId, new Set());
    watching.get(row.locationId).add(discordUserId);
  }

  for (const location of locations) {
    const live = liveLocationChannels.get(location.id);
    if (!live) continue;
    const label = `${location.zoneName}/${location.name}`;

    // STANDING beats WATCHING: somebody who walked back into a street they
    // were watching holds the full mask, not the mute one. Built in that
    // order so the second loop can never overwrite the first.
    const want = new Map();
    for (const c of alive) {
      if (c.locationId !== location.id || c.webOnly || !c.discordUserId) continue;
      want.set(c.discordUserId, STANDING);
    }
    for (const discordUserId of watching.get(location.id) ?? []) {
      if (want.has(discordUserId)) continue;
      want.set(discordUserId, WATCHING);
    }

    // BOTH bit sets come along, not just the id. The masks differ in their bits, and a watcher's
    // overwrite with the right allow but no deny still lets @everyone hand back thread-send and reactions.
    const has = new Map(
      (live.permission_overwrites ?? [])
        .filter((o) => Number(o.type) === 1)
        .map((o) => [o.id, { allow: String(o.allow ?? "0"), deny: String(o.deny ?? "0") }]),
    );

    for (const [userId, wanted] of want) {
      const held = has.get(userId);
      if (held && held.allow === wanted.allow && held.deny === wanted.deny) continue;
      const standing = wanted === STANDING;
      const why =
        held === undefined
          ? standing
            ? `${userId} stands here but the channel is closed to them`
            : `${userId} is still watching this place but the channel is closed to them`
          : `${userId} holds the wrong permissions here (allow ${held.allow} deny ${held.deny}, want allow ${wanted.allow} deny ${wanted.deny})`;
      await report("location-occupancy", label, why, () =>
        putChannelOverwrite(location.discordChannelId, userId, {
          allow: wanted.allow,
          deny: wanted.deny,
          type: 1,
        }),
      );
    }
    for (const userId of has.keys()) {
      if (want.has(userId)) continue;
      await report(
        "location-occupancy",
        label,
        `${userId} can read this channel but neither stands nor watches here`,
        () => deleteChannelOverwrite(location.discordChannelId, userId),
      );
    }
  }
}

module.exports = { runLocationOccupancySweep };
