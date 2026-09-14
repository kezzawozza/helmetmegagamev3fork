// Any Location holding a rotten corpse gets one line, randomized rather than cron so the smell
// isn't a clock players can read (CORPSES.md). Never pin this, and never write its id as an anchor.
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { sceneLineAt } = require("@lifeweb/db/lib/scene");

const MIN_DELAY_MS = 4 * 60 * 60 * 1000; // four to ten real hours, randomized; wall-clock on purpose
const MAX_DELAY_MS = 10 * 60 * 60 * 1000;
const SMELL = "It smells like death…";
const LINE = ambientLine(SMELL);

function nextDelay() {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
}

// A body in a bag smells as much as one on the floor, so stashed and carried both count.
async function locationsThatStink(prisma) {
  const rotten = { corpseKind: "ROTTEN" };
  const [stashed, carried] = await Promise.all([
    prisma.roomTag.findMany({
      where: { tag: rotten },
      select: { room: { select: { location: { select: { id: true, name: true, discordChannelId: true } } } } },
    }),
    prisma.characterTag.findMany({
      where: { tag: rotten, character: { status: "ALIVE" } },
      select: { character: { select: { location: { select: { id: true, name: true, discordChannelId: true } } } } },
    }),
  ]);

  const byId = new Map();
  for (const row of stashed) {
    const loc = row.room?.location;
    if (loc?.discordChannelId) byId.set(loc.id, loc);
  }
  for (const row of carried) {
    const loc = row.character?.location;
    if (loc?.discordChannelId) byId.set(loc.id, loc);
  }
  return [...byId.values()];
}

async function runDeathSmell(prisma) { // exported so a GM script or test can fire it by hand
  const locations = await locationsThatStink(prisma);
  let posted = 0;
  for (const loc of locations) { // sequential: never burst Discord's rate-limit buckets
    try {
      await postMessage(loc.discordChannelId, LINE);
      posted += 1;
    } catch (err) {
      console.error(`Death smell failed for ${loc.name}:`, err.message ?? err);
    }
    await sceneLineAt(prisma, { locationId: loc.id, text: SMELL }); // Chat shows the same smell as subtext
  }
  return posted;
}

function startDeathSmell(prisma) { // a thrown error inside runDeathSmell must never escape or it stops the chain silently
  const arm = () => {
    const delay = nextDelay();
    const timer = setTimeout(async () => {
      try {
        const posted = await runDeathSmell(prisma);
        if (posted > 0) console.log(`Death smell: ${posted} location(s) told.`);
      } catch (err) {
        console.error("Death smell pass failed:", err);
      } finally {
        arm();
      }
    }, delay);
    if (typeof timer.unref === "function") timer.unref(); // never hold the process open for a smell
  };
  arm();
}

module.exports = {
  startDeathSmell,
  runDeathSmell,
};
