// A GM's decree: a proclamation read into a zone, or into every zone at once.
// The Decree button on the adjudication desk is the only door
// (web/app/(desk)/gm/turns/DecreeComposer.js); the action there is the one caller.
//
// db/lib/intercom.js is the model, and the reason is the same one CLAUDE.md's
// "Bot message style" gives for the PA: this is NOT scenery, so it does not go
// through db/lib/ambientLine.js and it is not `-#` subtext. A decree is a notice
// nailed to the wall. Three ways it differs from the intercom:
//
//   - It goes out as an EMBED, not as a line of text. An embed is Discord's own
//     "this is a document, not a remark": a titled box with a rule down its side,
//     which is as close as Discord comes to the blackletter block the web draws
//     (web/app/components/TranscriptLine.js, variant="block").
//   - It carries NO `@here`. The PA is a loudspeaker and has to be heard over
//     whatever is happening; a decree is read, not shouted. Nothing in an embed
//     pings anybody in any case — Discord never notifies on an embed's text —
//     so the quiet is structural rather than a promise this file keeps.
//   - Every zone is reachable. The intercom has speakers strung to some zones
//     and not others; a decree reaches wherever the game can put words, so a
//     CAVE_LEVEL with no #summary gets it in each of its Location channels
//     through db/lib/publicPostTargets.js — the same one-source-of-truth a
//     staged public declaration posts through (ADJUDICATION.md §1a).
//
// Takes `prisma`, off the @lifeweb/db barrel (db/lib/dm.js convention).

const { postMessage } = require("./discordRest");
const { sceneLineAt } = require("./scene");
const { DECREE_LABEL, composeDecree, normalizeDecreeBody, normalizeDecreeTitle } = require("./decreeText");
// The same "where does a public GM line go" the push and Resend use (ADJUDICATION.md §1a).
const { publicTargetsFor } = require("./publicPostTargets");

// Discord's embed JSON, by hand: db/ has no discord.js (ARCHITECTURE.md, the
// REST/gateway twin convention). No `color` — a coloured stripe is the loudest
// thing an embed has, and the aura rule is understatement. The footer is the one
// word that says what kind of thing this is, the way the web's byline does.
function decreeEmbed({ title, body }) {
  return {
    title: normalizeDecreeTitle(title),
    description: normalizeDecreeBody(body),
    footer: { text: DECREE_LABEL },
  };
}

// Posts to each chosen zone, sequentially and individually caught. Never
// Promise.all a Discord fan-out (docs/systemdocs/TURN-ENGINE.md). Returns what
// happened per zone rather than throwing, so a GM is told which zones heard it.
//
// The ROW is written whether or not Discord took the post: the web feed is not
// Discord's understudy, and a zone whose #summary has not been provisioned yet
// still has a summary place on /chat (db/lib/feedAccess.js).
async function broadcastDecree(prisma, { title, body, zoneIds = [] } = {}) {
  const head = normalizeDecreeTitle(title);
  const text = normalizeDecreeBody(body);
  const embed = decreeEmbed({ title: head, body: text });
  const content = composeDecree({ title: head, body: text });

  const ids = [...new Set(zoneIds.filter(Boolean))];
  const zones = await prisma.zone.findMany({
    where: { id: { in: ids }, kind: { not: "CAVE_GROUP" } },
    select: { id: true, name: true, kind: true, discordSummaryChannelId: true },
    orderBy: { sortOrder: "asc" },
  });

  const results = [];
  for (const zone of zones) {
    const locations =
      zone.kind === "CAVE_LEVEL"
        ? await prisma.location.findMany({
            where: { zoneId: zone.id, discordChannelId: { not: null } },
            // Same ordering as worldBroadcast.js#ambientEverywhere.
            orderBy: { name: "asc" },
            select: { id: true, name: true, discordChannelId: true },
          })
        : [];
    const targets = publicTargetsFor({ zone, locations });

    let posted = 0;
    const failed = [];
    for (const target of targets) {
      try {
        // No content, no components, no allowed_mentions: the embed is the whole
        // message. `postMessage` drops an undefined content from the body.
        await postMessage(target.channelId, undefined, undefined, undefined, [embed]);
        posted += 1;
      } catch (err) {
        failed.push(target.name ?? zone.name);
        console.error(`Decree to ${zone.name} failed:`, err.message ?? err);
      }
    }

    // ONE ROW PER ZONE, not one for the broadcast — a zone feed can only show a
    // row filed against its own place key, which is the bug the intercom had for
    // a while (CHAT.md §2). `channelKind: "decree"` is the whole of what tells
    // Feed.js to draw the blackletter block.
    await sceneLineAt(prisma, {
      zoneId: zone.id,
      text: content,
      signed: false,
      channelKind: "decree",
    });

    results.push({
      zoneId: zone.id,
      zoneName: zone.name,
      posted,
      // A zone with nowhere to post is not a failure to report as one: an
      // unprovisioned #summary is a channel that does not exist yet, and the row
      // still landed. Named separately so the desk can say which it was.
      unreachable: targets.length === 0,
      failed,
    });
  }

  return {
    zones: results,
    sent: results.length,
    posted: results.reduce((n, r) => n + r.posted, 0),
    failed: results.filter((r) => r.failed.length > 0 || r.unreachable).map((r) => r.zoneName),
  };
}

module.exports = { broadcastDecree, decreeEmbed };
