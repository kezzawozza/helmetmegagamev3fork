// The full-scope stray-member-overwrite sweep. A per-member overwrite on a
// zone's CATEGORY or #summary belongs to nobody — access there rides the zone
// role — so one that has appeared is swept off.
//
// The role side of this channel's permissions is the mirror's op list now
// (db/lib/discordMirror/diff.js#overwrites), which is why the spec-drift half
// of this sweep is gone rather than running a second reconcile behind it.
const { getChannel, deleteChannelOverwrite } = require("../../discordRest");
const { zoneChannelSpec } = require("../../zoneChannelSpec");

async function runOverwritesSweep({ report, errors, zones, spectators }) {
  // Zone categories and #summary only. A LOCATION channel is deliberately not
  // in this list: since Bascinet 2 the per-member overwrite IS how an occupant
  // is let in (CHANNELS.md 3), so a sweep that took member overwrites off one
  // would throw every player out of the room they are standing in. That
  // happened once, on a single `--full --apply`.
  const overwriteTargets = [];
  for (const zone of zones) {
    const spec = zoneChannelSpec(zone, { spectators });
    overwriteTargets.push([`${zone.name}/category`, zone.discordCategoryId, spec.category]);
    overwriteTargets.push([`${zone.name}/summary`, zone.discordSummaryChannelId, spec.summary]);
  }

  for (const [label, channelId, want] of overwriteTargets) {
    if (!channelId || !want) continue;
    let live;
    try {
      live = await getChannel(channelId, { allow404: true });
    } catch (err) {
      errors.push({ check: "overwrites", target: label, message: err.message });
      continue;
    }
    if (!live) continue;

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
}

module.exports = { runOverwritesSweep };
