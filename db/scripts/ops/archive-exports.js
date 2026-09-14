// What archive packets exist, and whether the nightly is still running.
//
//   npm run archive:exports
//
// EXITS 1 if the current game has no packet from the last 36 hours — a
// backup system fails quietly, not loudly.
require("dotenv").config();
const { prisma } = require("../../index");
const { listObjects, livePrefix, ARCHIVE_PREFIX } = require("../../lib/archiveBucket");

const STALE_HOURS = 36;

function mb(n) {
  return `${(n / 1048576).toFixed(2)} MB`;
}

async function main() {
  const all = await listObjects(`${ARCHIVE_PREFIX()}/`);
  if (all.length === 0) {
    console.log(`No archive packets under ${ARCHIVE_PREFIX()}/.`);
  }
  for (const o of [...all].sort((a, b) => (a.modified < b.modified ? 1 : -1))) {
    console.log(`  ${o.key.padEnd(60)} ${mb(o.size).padStart(10)}  ${o.modified}`);
  }

  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { gameId: true } });
  const gameId = state?.gameId;
  if (!gameId) {
    console.log("\nNo current game — nothing to be stale.");
    return;
  }

  const mine = all.filter((o) => o.key.startsWith(livePrefix(gameId)));
  if (mine.length === 0) {
    console.log(`\nWARNING: the current game (${gameId}) has no packet at all.`);
    console.log("The nightly archive export is not running — check the archive-export service.");
    process.exitCode = 1;
    return;
  }

  const newest = mine.map((o) => new Date(o.modified)).sort((a, b) => b - a)[0];
  const hours = (Date.now() - newest.getTime()) / 3600000;
  console.log(`\nCurrent game's newest packet is ${hours.toFixed(1)}h old.`);
  if (hours > STALE_HOURS) {
    console.log(`\nWARNING: over ${STALE_HOURS}h. The nightly archive export is not working.`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
