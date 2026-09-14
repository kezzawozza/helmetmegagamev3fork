// The channel doctor's full-scope channel overwrite sweep — zone
// category/#summary and Location channel permission overwrites vs. their
// spec. Moved verbatim out of runChannelDoctor (W2d).
const { getChannel, deleteChannelOverwrite } = require("../../discordRest");
const { zoneChannelSpec, locationChannelSpec } = require("../../zoneChannelSpec");
const { reconcileChannelOverwrites, managedOverwriteIds } = require("../../syncZones");

async function runOverwritesSweep({ report, errors, zones, locations, spectators, zoneRoleIds, zoneGmRoleIds }) {
  // Zone roles only. A member target must never enter this set — it is the
  // allowlist of overwrites the reconcile may DELETE, and every occupant of
  // every Location channel is a member overwrite (CHANNELS.md §3).
  // BOTH role families, and the GM seats matter more than they look. The
  // set is what the reconcile may DELETE when the spec no longer names a
  // target — and a zone whose gmRoleId is still null names no GM at all, so
  // without its seat in here a full run would sweep the live global-GM
  // overwrite off every one of that zone's channels and put nothing back.
  // db:sync-zones learned this at syncZones.js#managedOverwriteIds; this is
  // the same lesson on the doctor's side.
  const managed = managedOverwriteIds([...zoneRoleIds, ...zoneGmRoleIds]);

  const overwriteTargets = [];
  for (const zone of zones) {
    const spec = zoneChannelSpec(zone, { spectators });
    overwriteTargets.push([`${zone.name}/category`, zone.discordCategoryId, spec.category, false]);
    overwriteTargets.push([`${zone.name}/summary`, zone.discordSummaryChannelId, spec.summary, false]);
  }
  for (const location of locations) {
    overwriteTargets.push([
      `${location.zoneName}/${location.name}`,
      location.discordChannelId,
      locationChannelSpec(location, location.zoneGmRoleId ?? null, { spectators }),
      true,
    ]);
  }
  {
    for (const [label, channelId, want, isLocation] of overwriteTargets) {
      if (!channelId || !want) continue;
      let live;
      try {
        live = await getChannel(channelId, { allow404: true });
      } catch (err) {
        errors.push({ check: "overwrites", target: label, message: err.message });
        continue;
      }
      if (!live) continue;

      // A member overwrite on a zone's CATEGORY or #summary belongs to
      // nobody; access there rides the zone role.
      //
      // A LOCATION channel is the opposite, and this sweep used to take it
      // down with the rest: since Bascinet 2 the per-member overwrite IS how
      // an occupant is let in (CHANNELS.md §3), so one `--full --apply` threw
      // every player out of every Location channel at once and left them out
      // until the next run — the occupancy check that puts them back has
      // already run by the time this gets here.
      if (!isLocation) {
        for (const overwrite of live.permission_overwrites ?? []) {
          if (overwrite.type !== 1) continue;
          await report(
            "member-overwrite",
            `${label}/${overwrite.id}`,
            "stray per-member overwrite on a game channel",
            () => deleteChannelOverwrite(channelId, overwrite.id),
          );
        }
      }

      // Spec drift, repaired with the same reconcile the sync uses.
      const wanted = new Map(want.permission_overwrites.map((o) => [o.id, o]));
      const liveById = new Map((live.permission_overwrites ?? []).map((o) => [o.id, o]));
      let drifted = false;
      for (const [id, o] of wanted) {
        const l = liveById.get(id);
        if (!l || (l.allow ?? "0") !== (o.allow ?? "0") || (l.deny ?? "0") !== (o.deny ?? "0")) {
          drifted = true;
          break;
        }
      }
      if (!drifted) {
        for (const [id, o] of liveById) {
          if (!wanted.has(id) && managed.has(id) && o.type === 0) drifted = true;
        }
      }
      if (drifted) {
        await report("overwrites", label, "channel overwrites drifted from the spec", () =>
          reconcileChannelOverwrites(channelId, want, managed),
        );
      }
    }
  }
}

module.exports = { runOverwritesSweep };
