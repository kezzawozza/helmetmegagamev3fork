// One `-#` line of scenery into a place, on Discord and on /chat.
//
// The world saying something into a channel is subtext (CLAUDE.md, "Bot
// message style") and it always goes out twice: to the Discord thread or
// channel, and into the archive so /chat's feed shows the same line. Getting
// that pair right by hand is two easy mistakes — forgetting the archive half,
// and forgetting that `-#` is PER LINE, which ambientLine() handles.
//
// This lived inside db/lib/riteEffects.js, which still re-exports both names
// so the rites and riteChant.js are untouched. It moved here when a second
// system (kissing) wanted the same pair: a rite module is the wrong home for
// "how does a room hear a thing", and the alternative was a third hand-rolled
// copy beside riteEffects' and roomAnnounce's.
//
// Takes `db` as a parameter and is NOT on the @lifeweb/db barrel — the
// db/lib/dm.js convention. Require it by path.
const { postMessage } = require("./discordRest");
const { ambientLine } = require("./ambientLine");
const { sceneLineAt } = require("./scene");

const log = (what) => (err) => console.error(`Place line: ${what} failed:`, err?.message ?? err);

// BOTH halves are caught, and that is load-bearing rather than tidy. These are
// scenery: a line nobody heard must never take down the thing that caused it.
// A rite has already eaten the ingredients off the floor by the time it
// speaks, and a kiss has already moved two dials.

// The room hears one line. `room` needs { id, name, discordThreadId }.
async function roomLine(db, room, text) {
  if (room?.discordThreadId) {
    await postMessage(room.discordThreadId, ambientLine(text)).catch(log(`room line (${room.name})`));
  }
  if (room?.id) await sceneLineAt(db, { roomId: room.id, text, signed: false }).catch(log(`room scene (${room.name})`));
}

// A Location's channel hears one line. `location` needs { id, name, discordChannelId }.
async function locationLine(db, location, text) {
  if (location?.discordChannelId) {
    await postMessage(location.discordChannelId, ambientLine(text)).catch(log(`location line (${location.name})`));
  }
  if (location?.id) {
    await sceneLineAt(db, { locationId: location.id, text, signed: false }).catch(log(`location scene (${location.name})`));
  }
}

module.exports = { roomLine, locationLine };
