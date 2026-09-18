// Manual sync from docs/roles.yaml -> the Role table (`npm run
// db:sync-roles`). Run AFTER db:sync-locations and db:sync-tags — roles
// resolve a starting Location by slug and validate starting_tags against the
// Tag catalog, and will throw rather than half-apply if either hasn't synced yet.
require("dotenv").config();
const { prisma, syncRolesFromYaml } = require("../../index");

async function main() {
  const s = await syncRolesFromYaml(prisma);
  console.log(`roles created: ${s.rolesCreated}`);
  console.log(`roles updated: ${s.rolesUpdated}`);
  if (s.rolesPruned.length) console.log(`roles pruned: ${s.rolesPruned.join(", ")}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
