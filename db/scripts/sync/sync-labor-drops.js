// Manual sync from docs/labordrops.yaml -> DB (`npm run db:sync-labor-drops`).
// Run AFTER db:import-zones and db:sync-tags — every slug named in the YAML is
// validated against the Tag/Zone/Location rows those create.
require("dotenv").config();
const { prisma, syncLaborDropsFromYaml } = require("../../index");

async function main() {
  const summary = await syncLaborDropsFromYaml(prisma);
  console.log(`labor drop options: ${summary.total}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
