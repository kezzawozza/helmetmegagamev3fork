// docs/zones.yaml -> DB, one-shot and additive.
//
//   npm run db:import-zones            # what would be created
//   npm run db:import-zones -- --apply # actually create it
//
// Never updates, never deletes, never seeds a stash — see
// db/lib/importZones.js. Ends by enqueuing the mirror for anything it just
// created, so Discord catches up on the next drain.
require("dotenv").config();
const { prisma } = require("../../index");
const { importZonesFromYaml } = require("../../lib/importZones");

async function main() {
  const apply = process.argv.includes("--apply");
  const report = await importZonesFromYaml(prisma, { apply });

  const { zones, locations, rooms, links, yields, structures } = report.created;
  const total = zones.length + locations.length + rooms.length + links.length + yields.length + structures.length;

  if (total === 0) {
    console.log("Nothing to import — every slug in docs/zones.yaml already exists.");
  } else {
    console.log(`${apply ? "Created" : "Would create"} ${total} row(s):`);
    if (zones.length) console.log(`  zones: ${zones.join(", ")}`);
    if (locations.length) console.log(`  locations: ${locations.join(", ")}`);
    if (rooms.length) console.log(`  rooms: ${rooms.join(", ")}`);
    if (links.length) console.log(`  links: ${links.join(", ")}`);
    if (yields.length) console.log(`  yields: ${yields.join(", ")}`);
    if (structures.length) console.log(`  structures: ${structures.join(", ")}`);
  }

  if (report.skipped.length) {
    console.log(`${report.skipped.length} already existed, untouched:`);
    for (const line of report.skipped) console.log(`  - ${line}`);
  }
  if (report.warnings.length) {
    console.log("Warnings:");
    for (const w of report.warnings) console.log(`  ! ${w}`);
  }

  if (!apply) {
    console.log("\nDry run. Re-run with `-- --apply` to create them.");
  } else if (report.mirrorTargets.length) {
    console.log(`\nEnqueued ${report.mirrorTargets.length} target(s) for the Discord mirror.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
