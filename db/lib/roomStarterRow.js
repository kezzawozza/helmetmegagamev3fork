// The buttons on a Room's starter post: Storage (docs/systemdocs/CARRY.md), Intercom on the Council Room (db/lib/intercom.js), Toggle Turret on the Censor's Office (db/lib/gatehouseTurret.js) and on the Merchant's Office (db/lib/depotCounter.js), Sound Bell on the Cathedral's Bell Tower (db/lib/bell.js), the ATM on the Storefront and the Drop Box in the Railyard (docs/systemdocs/DEPOT.md). Watchtowers get a SECOND row composed by db/lib/syncZones.js#roomComponents. Raw component JSON, same reason as locationAnchorRow.js — the sync posts it over REST from db/, which has no discord.js.
// The room id rides in the custom_id, routed by prefix in bot/src/events/interactionCreate.js — change it here and you must change it there. This row is hashed into Room.postHash.

// Labels and predicates live in db/lib/placeAffordances.js; this file is just Discord's shape (one row, a style per tone).
const {
  DANGER: DANGER_TONE,
  CENSOR_OFFICE_ROOM_SLUG,
  WATCHTOWER_ROOM_SLUGS,
  ROOM_STORAGE_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  ROOM_PRAY_PREFIX,
  ROOM_ATM_PREFIX,
  ROOM_DROPBOX_PREFIX,
  ROOM_DEPOT_TURRET_PREFIX,
  roomAffordances,
} = require("./placeAffordances");

const ACTION_ROW = 1;
const BUTTON = 2;
const SECONDARY = 2;
const DANGER = 4;

// `room` needs { id, slug }.
function roomStarterRow(room) {
  return {
    type: ACTION_ROW,
    components: roomAffordances(room).map((entry) => ({
      type: BUTTON,
      style: entry.tone === DANGER_TONE ? DANGER : SECONDARY,
      custom_id: entry.customId,
      label: entry.label,
    })),
  };
}

module.exports = {
  WATCHTOWER_ROOM_SLUGS,
  ROOM_STORAGE_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  ROOM_PRAY_PREFIX,
  ROOM_ATM_PREFIX,
  ROOM_DROPBOX_PREFIX,
  ROOM_DEPOT_TURRET_PREFIX,
  CENSOR_OFFICE_ROOM_SLUG,
  roomStarterRow,
};
