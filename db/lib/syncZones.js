// docs/zones.yaml -> DB + Discord, used by `npm run db:sync-zones` and wipeGameData's "Restart Game" flow. docs/zones.yaml is the sole source of truth for the Zone / Location / Room roster: this reconciles DB + Discord to match it, upserting entries present and destructively removing anything no longer listed. Five passes: parse+validate, DB upsert, Discord provisioning (create-only), reconcile (every run), prune. A thin barrel — the actual work lives in db/lib/syncZones/.
const { parseZonesYaml, managedOverwriteIds, reconcileChannelOverwrites } = require("./syncZones/parse");
const { buildAnchorBody } = require("./syncZones/bodies");
const { syncRoomThread, gatesFor } = require("./syncZones/roomThreads");
const {
  syncZonesFromYaml,
  refreshLiveRooms,
  refreshLocationAnchor,
  refreshGateRooms,
} = require("./syncZones/sync");

module.exports = {
  syncZonesFromYaml,
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
