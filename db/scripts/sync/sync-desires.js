// Manual sync from docs/desires.yaml -> DB (`npm run db:sync-desires`). Run
// AFTER db:sync-tags and db:sync-roles — desires validate their
// requires.anyTags/notTags and anyRoles/notRoles against the DB, not the YAML.
require("dotenv").config();
const { prisma, syncDesiresFromYaml } = require("../../index");

async function main() {
  const summary = await syncDesiresFromYaml(prisma);
  console.log(`templates created: ${summary.created}`);
  console.log(`templates updated: ${summary.updated}`);
  console.log(`links updated: ${summary.linksUpdated}`);
  console.log(`templates retired: ${summary.retired}`);
  console.log(`templates unretired: ${summary.unretired}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
