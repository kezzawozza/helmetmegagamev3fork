// Manual sync from docs/miningdrops.yaml -> DB (`npm run db:sync-mining-drops`).
// Run AFTER db:import-zones and db:sync-tags — every slug named in the YAML is
// validated against the Tag/Zone/Location rows those create.
require("dotenv").config();
const { prisma, syncMiningDropsFromYaml } = require("../../index");

async function main() {
  const summary = await syncMiningDropsFromYaml(prisma);
  console.log(`mining drop options: ${summary.total}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
