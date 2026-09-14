// Manual sync from docs/tags.yaml + docs/taggroups.yaml -> DB (`npm run db:sync-tags`).
require("dotenv").config();
const { prisma, syncTagsFromYaml } = require("../../index");

async function main() {
  const summary = await syncTagsFromYaml(prisma);
  console.log(`groups created: ${summary.groupsCreated}`);
  console.log(`groups updated: ${summary.groupsUpdated}`);
  console.log(`tags created: ${summary.tagsCreated}`);
  console.log(`tags updated: ${summary.tagsUpdated}`);
  console.log(`parent/required links updated: ${summary.linksUpdated}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
