// Manual sync from docs/documents.yaml -> DB (`npm run db:sync-documents`).
// Run AFTER db:sync-tags and db:sync-roles — assignment references are
// validated against the Tag and Role rows those two create.
require("dotenv").config();
const { prisma, syncDocumentsFromYaml } = require("../../index");

async function main() {
  const summary = await syncDocumentsFromYaml(prisma);
  console.log(`documents created: ${summary.created}`);
  console.log(`documents updated: ${summary.updated}`);
  if (summary.pruned.length > 0) {
    console.log(`pruned (no longer in the YAML): ${summary.pruned.join(", ")}`);
  }
  const unresolved = Object.entries(summary.unresolved);
  if (unresolved.length > 0) {
    console.log("\nunmatched `tags:` entries (left as authoring notes, not applied):");
    for (const [key, names] of unresolved) {
      console.log(`  ${key}: ${names.join(", ")}`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
