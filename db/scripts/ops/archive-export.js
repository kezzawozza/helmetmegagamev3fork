// Export one game's transcript as an archive packet, verify it, and put it in
// the bucket. See docs/systemdocs/ARCHIVE.md.
//
//   npm run archive:export                    # the current game
//   npm run archive:export -- --game <id>     # a named one
//   npm run archive:export -- --final         # the permanent packet for a
//                                             #   finished game, and stamp
//                                             #   Game.exportKey
//   npm run archive:export -- --no-upload     # write the file and stop
//
// Read-only against the database unless --final, which stamps exportKey and
// entryCount on the Game row. It never deletes an ArchiveEntry: the delete
// belongs to Restart Game, and only ever after this has stamped the row.
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { prisma } = require("../../index");
const { exportGame, verifyPacket } = require("../../lib/archiveExport");
const {
  bucketConfigured, putObject, deleteObject, listObjects, finalKey, liveKey, livePrefix,
} = require("../../lib/archiveBucket");

const KEEP_LIVE = 3; // rolling window; the permanent --final copy is never pruned

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? true;
}
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
  const final = has("final");
  const wanted = arg("game");
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { gameId: true } });
  const gameId = typeof wanted === "string" ? wanted : state?.gameId;
  if (!gameId) {
    console.error("No game to export: pass --game <id>, or open one first.");
    process.exitCode = 1;
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const key = final ? finalKey(gameId) : liveKey(gameId, stamp);
  const out = path.join(os.tmpdir(), path.basename(key));

  console.log(`Exporting game ${gameId}…`);
  const manifest = await exportGame(prisma, { gameId, outPath: out });
  console.log(`  ${manifest.entryCount} entries, seq ${manifest.minSeq ?? "-"}–${manifest.maxSeq ?? "-"}`);

  await verifyPacket(out); // read back what was written before anything is told it exists
  const size = fs.statSync(out).size;
  console.log(`  verified — ${(size / 1048576).toFixed(2)} MB at ${out}`);

  if (has("no-upload")) {
    console.log("\n--no-upload: left the file in place, nothing uploaded.");
    return;
  }

  if (!bucketConfigured()) {
    console.error("\nNo bucket credentials in this environment (S3_ENDPOINT / S3_BUCKET / AWS_*).");
    console.error(`The packet is at ${out} — upload it by hand, or re-run with --no-upload.`);
    process.exitCode = 1;
    return;
  }

  await putObject(key, fs.readFileSync(out));
  console.log(`  uploaded to ${key}`);

  if (!final) {
    const listed = (await listObjects(livePrefix(gameId))) // scoped by prefix; can never reach the final packet
      .map((o) => o.key)
      .sort();
    for (const stale of listed.slice(0, Math.max(0, listed.length - KEEP_LIVE))) {
      await deleteObject(stale);
      console.log(`  pruned ${stale}`);
    }
  }

  if (final) {
    await prisma.game.update({
      where: { id: gameId },
      data: {
        exportKey: key,
        entryCount: manifest.entryCount,
        exportMaxSeq: manifest.maxSeq === null ? null : BigInt(manifest.maxSeq),
      },
    });
    console.log(`\nStamped Game.exportKey. Restart Game can archive this one now.`);
  }
  fs.unlinkSync(out);
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
