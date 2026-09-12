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

const log = (what) => (err) => {
  console.error(`Place line: ${what} failed:`, err?.message ?? err);
  return FAILED;
};

// What a swallowed half resolves to, so a caller who wants to know can ask
// without any of them having to stop swallowing. Every function below returns
// { posted, archived } — false means that half did not land, and the callers
// who do not care go on ignoring it.
//
// Null counts as not landed too, and that is not belt and braces: scene.js
// catches its own failures and answers null rather than throwing, so a thrown
// rejection is only one of the two ways an archive write can come to nothing.
const FAILED = Symbol("failed");
const landed = (result) => result !== FAILED && result != null;

// BOTH halves are caught, and that is load-bearing rather than tidy. These are
// scenery: a line nobody heard must never take down the thing that caused it.
// A rite has already eaten the ingredients off the floor by the time it
// speaks, and a kiss has already moved two dials.

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
//
// The third of these, and it arrived late: the two above were written for a
// rite and a kiss, which both happen somewhere you are standing. A GM's
// ambient line can be aimed at a whole zone, and that path was hand-rolling
// the Discord half with no archive half at all — so a line a GM said into
// #summary reached Discord and never reached /chat.
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
