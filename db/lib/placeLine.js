// One `-#` line of scenery into a place (CLAUDE.md, "Bot message style"),
// always going out twice: to the Discord thread/channel, and into the
// archive so /chat's feed shows the same line. `db/lib/riteEffects.js`
// re-exports these names. Takes `db` as a parameter and is NOT on the
// @lifeweb/db barrel — the db/lib/dm.js convention. Require it by path.
const { postMessage } = require("./discordRest");
const { ambientLine } = require("./ambientLine");
const { sceneLineAt } = require("./scene");

const log = (what) => (err) => {
  console.error(`Place line: ${what} failed:`, err?.message ?? err);
  return FAILED;
};

// Every function below returns { posted, archived }; false means that half
// did not land. Null also counts as not-landed: scene.js catches its own
// failures and returns null rather than throwing.
const FAILED = Symbol("failed");
const landed = (result) => result !== FAILED && result != null;

// BOTH halves are caught: this is scenery, and a line nobody heard must never
// take down the thing that caused it.

// The room hears one line. `room` needs { id, name, discordThreadId }.
async function roomLine(db, room, text) {
  let posted = false;
  let archived = false;
  if (room?.discordThreadId) {
    posted = landed(await postMessage(room.discordThreadId, ambientLine(text)).catch(log(`room line (${room.name})`)));
  }
  if (room?.id) {
    archived = landed(
      await sceneLineAt(db, { roomId: room.id, text, signed: false }).catch(log(`room scene (${room.name})`)),
    );
  }
  return { posted, archived };
}

// A Location's channel hears one line. `location` needs { id, name, discordChannelId }.
async function locationLine(db, location, text) {
  let posted = false;
  let archived = false;
  if (location?.discordChannelId) {
    posted = landed(
      await postMessage(location.discordChannelId, ambientLine(text)).catch(log(`location line (${location.name})`)),
    );
  }
  if (location?.id) {
    archived = landed(
      await sceneLineAt(db, { locationId: location.id, text, signed: false }).catch(
        log(`location scene (${location.name})`),
      ),
    );
  }
  return { posted, archived };
}

// A zone's #summary hears one line. `zone` needs { id, name,
// discordSummaryChannelId }.
async function zoneLine(db, zone, text) {
  let posted = false;
  let archived = false;
  if (zone?.discordSummaryChannelId) {
    posted = landed(
      await postMessage(zone.discordSummaryChannelId, ambientLine(text)).catch(log(`zone line (${zone.name})`)),
    );
  }
  if (zone?.id) {
    archived = landed(
      await sceneLineAt(db, { zoneId: zone.id, text, signed: false }).catch(log(`zone scene (${zone.name})`)),
    );
  }
  return { posted, archived };
}

module.exports = { roomLine, locationLine, zoneLine };
