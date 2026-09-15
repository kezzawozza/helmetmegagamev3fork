// Ravenheart's PA — a button on the table in the Council Room (docs/zones.yaml). The announcement
// lands in each zone's own #summary. The Black Hills do not hear it (no speaker strung that far); the
// two cave levels have no #summary at all, so the rock swallows it for free. Takes `prisma`, off the
// @lifeweb/db barrel (db/lib/dm.js convention).
const { postMessage } = require("./discordRest");
const { sceneLineAt } = require("./scene");

// The Council Room, hardcoded for the db/lib/roleIds.js reason.
const INTERCOM_ROOM_SLUG = "keep-council-room";

// Zone slugs the PA does not reach. `hills` is the Black Hills.
const OUT_OF_RANGE_ZONE_SLUGS = ["hills"];

// The body is player-typed, so `parse: ["everyone"]` lets OUR @here through while blocking any ping
// somebody types — but it's one permission covering both @everyone and @here, so the body is also
// defanged below, or anybody at the table could escalate to @everyone.
const ALLOWED_MENTIONS = { parse: ["everyone"] };

// Break a typed @everyone/@here without eating the word: a zero-width space
// after the @ stops Discord matching it, and reads identically.
function defang(text) {
  return text.replace(/@(everyone|here)\b/gi, "@\u200b$1");
}

// Discord caps a message at 2000 characters and the modal caps the input well
// under that, so this is always one message — which matters, because chunking
// would ping @here once per chunk.
const MAX_BODY = 1200;

// Deliberately NOT ambientLine — a PA is the opposite of scenery, it's a loudspeaker carrying an
// @here, so it's full size. That also means the body can carry newlines safely (no per-line prefix to break).
function intercomLine(text) {
  const body = defang(String(text ?? "").trim().slice(0, MAX_BODY));
  // Supply a full stop only when the speaker didn't end on one themselves,
  // so "Get to the wall!" doesn't broadcast as "Get to the wall!."
  const stop = /[.!?…]$/.test(body) ? "" : ".";
  return `@here You hear a voice from the intercom: ${body}${stop}`;
}

// Posts to every zone in range, sequentially and individually caught. Never Promise.all a Discord
// fan-out (docs/systemdocs/TURN-ENGINE.md). Returns { sent, failed } rather than throwing.
async function broadcastIntercom(prisma, text) {
  const content = intercomLine(text);
  const zones = await prisma.zone.findMany({
    where: { discordSummaryChannelId: { not: null }, slug: { notIn: OUT_OF_RANGE_ZONE_SLUGS } },
    select: { id: true, name: true, discordSummaryChannelId: true },
    orderBy: { sortOrder: "asc" },
  });

  let sent = 0;
  const failed = [];
  for (const zone of zones) {
    try {
      await postMessage(zone.discordSummaryChannelId, content, undefined, ALLOWED_MENTIONS);
      sent += 1;
    } catch (err) {
      failed.push(zone.name);
      console.error(`Intercom broadcast to ${zone.name} failed:`, err.message ?? err);
    }
    // ONE ROW PER ZONE, not one for the broadcast — a zone feed can only show a row filed against its
    // own place key. The @here is Discord's alone, not part of what was said. channelKind: "intercom"
    // is what tells Feed.js this is a loudspeaker, not scenery — see db/lib/scene.js.
    await sceneLineAt(prisma, {
      zoneId: zone.id,
      text: content.replace(/^@here\s+/, ""),
      signed: false,
      channelKind: "intercom",
    });
  }
  return { sent, failed };
}

module.exports = {
  INTERCOM_ROOM_SLUG,
  OUT_OF_RANGE_ZONE_SLUGS,
  broadcastIntercom,
};
