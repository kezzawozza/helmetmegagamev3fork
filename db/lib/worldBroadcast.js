// Two fan-outs that reach the WHOLE map, for events that are news everywhere
// at once, not scenery in one room. Unlike db/lib/soundBroadcast.js (range-
// gated from an origin) these have no origin. Unlike db/lib/intercom.js they
// don't defang mentions, wrap in "you hear a voice", or skip the Black Hills.
// Both post sequentially and catch each error, never letting a burst of
// parallel posts or one dead channel take the rest of the fan-out down.
// Takes `prisma` as a parameter, off the @lifeweb/db barrel (db/lib/dm.js
// convention); require it by path.
const { postMessage } = require("./discordRest");
const { ambientLine } = require("./ambientLine");
const { sceneLineAt } = require("./scene");

// Only set for a message that is MEANT to wake people who are offline. The
// nuke is the one thing in the game that qualifies.
const EVERYONE = { parse: ["everyone"] };

// Every zone's #summary; skips NO zone (cave levels drop out on their own,
// having no #summary).
async function broadcastToZones(prisma, content, { mentionEveryone = false } = {}) {
  const zones = await prisma.zone.findMany({
    where: { discordSummaryChannelId: { not: null } },
    select: { id: true, name: true, discordSummaryChannelId: true },
    orderBy: { sortOrder: "asc" },
  });

  let sent = 0;
  const failed = [];
  for (const zone of zones) {
    try {
      await postMessage(
        zone.discordSummaryChannelId,
        content,
        undefined,
        mentionEveryone ? EVERYONE : undefined,
      );
      sent += 1;
    } catch (err) {
      failed.push(zone.name);
      console.error(`World broadcast to ${zone.name} failed:`, err.message ?? err);
    }
    // Beside the post, never instead (db/lib/scene.js). Written even when
    // the post failed: the thing happened.
    await sceneLineAt(prisma, { zoneId: zone.id, text: content, signed: false });
  }
  return { sent, failed };
}

// Every Location channel. `text` is wrapped in ambientLine here, not by the
// caller, since a line the WORLD says is `-#` subtext (CLAUDE.md).
async function ambientEverywhere(prisma, text, { signed = true } = {}) {
  const content = ambientLine(text, [], { signed });
  const locations = await prisma.location.findMany({
    where: { discordChannelId: { not: null } },
    select: { id: true, name: true, discordChannelId: true },
    orderBy: { name: "asc" },
  });

  let sent = 0;
  const failed = [];
  for (const location of locations) {
    try {
      await postMessage(location.discordChannelId, content);
      sent += 1;
    } catch (err) {
      failed.push(location.name);
      console.error(`Ambient broadcast to ${location.name} failed:`, err.message ?? err);
    }
    // Chat's half: plain sentence, no `-#`; the web renders subtext itself.
    await sceneLineAt(prisma, { locationId: location.id, text, signed });
  }
  return { sent, failed };
}

module.exports = { broadcastToZones, ambientEverywhere };
