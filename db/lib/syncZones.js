// A thin barrel over db/lib/syncZones/ — parsing docs/zones.yaml
// (parse.js#parseZonesYaml, reused by db/lib/importZones.js), the room-thread
// builder shared with db/lib/quests.js, and the handful of refresh helpers
// still called from a gate flip, a shuttle launch or the Depot. The old five-pass
// destructive zones sync is gone: standing a place up from the YAML
// is now the additive `npm run db:import-zones`, and keeping Discord true to the
// database is `db/lib/discordMirror/`.
const { parseZonesYaml, managedOverwriteIds, reconcileChannelOverwrites } = require("./syncZones/parse");
const { buildAnchorBody } = require("./syncZones/bodies");
const { syncRoomThread, gatesFor } = require("./syncZones/roomThreads");
const {
  refreshLiveRooms,
  refreshLocationAnchor,
  refreshGateRooms,
} = require("./syncZones/sync");

module.exports = {
  // Exported for db/lib/quests.js, which mints a Room at runtime and must build its thread and starter post exactly the way the sync does.
  syncRoomThread,
  refreshLiveRooms,
  parseZonesYaml,
  reconcileChannelOverwrites,
  managedOverwriteIds,
  buildAnchorBody,
  gatesFor,
  refreshLocationAnchor,
  refreshGateRooms,
};
