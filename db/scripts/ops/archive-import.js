// Load an archive packet back into the database (ARCHIVE.md).
//
//   npm run archive:import -- <file>            # a packet already on disk
//   npm run archive:import -- --key <s3 key>    # pull it down first
//   npm run archive:import -- <file> --remap-seq
//
// Read-only inspection of an old game, not a resurrection: rows land under
// their own gameId, below the feed floor, and /chat never shows them. Prints
// what it dropped and what it let default, since a silent tolerant importer rots.
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { prisma } = require("../../index");
const { importPacket } = require("../../lib/archiveExport");
const { getObject } = require("../../lib/archiveBucket");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

async function main() {
  const key = arg("key");
  let file = process.argv.slice(2).find((a) => !a.startsWith("--") && a !== key);

  if (key) {
    file = path.join(os.tmpdir(), path.basename(key));
    fs.writeFileSync(file, await getObject(key));
    console.log(`Pulled ${key} down to ${file}`);
  }
  if (!file) {
    console.error("Pass a packet file, or --key <s3 key>.");
    process.exitCode = 1;
    return;
  }

  const report = await importPacket(prisma, file, { remapSeq: process.argv.includes("--remap-seq") });
  const { manifest } = report;

  console.log(`\nGame ${manifest.gameId}, exported ${manifest.exportedAt}`);
  console.log(`  ${report.written} written, ${report.skipped} already there`);
  if (!report.complete) {
    console.log(
      `\n  INCOMPLETE: the game holds ${report.present} rows but the packet has ` +
      `${manifest.entryCount}. Rows were skipped as duplicates whose ids belong to ` +
      `something else — this packet has NOT been loaded.`,
    );
    process.exitCode = 1;
  }
  if (report.remapped) console.log("  seq remapped — the packet's own cursor values were not kept");
  if (report.droppedColumns.length) {
    console.log(`\n  DROPPED (in the packet, gone from the schema): ${report.droppedColumns.join(", ")}`);
  }
  if (report.defaultedColumns.length) {
    console.log(`  DEFAULTED (in the schema, not in the packet): ${report.defaultedColumns.join(", ")}`);
  }
  if (!report.droppedColumns.length && !report.defaultedColumns.length) {
    console.log("  every column matched the current schema");
  }
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
