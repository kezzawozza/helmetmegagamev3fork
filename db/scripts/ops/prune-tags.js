// The destructive counterpart to `npm run db:sync-tags`. `npm run
// db:prune-tags` to preview, `-- --apply` to delete. Deliberately NOT wired
// into wipeGameData's "Restart Game" flow — a wipe clears every CharacterTag
// first, so a prune running there would delete every GM-created tag but for
// the custom flag. Keeping it out keeps the blast radius somewhere a human
// is watching.
require("dotenv").config();
const { prisma } = require("../../index");
const { pruneTagsFromYaml } = require("../../lib/pruneTags");

async function main() {
  const apply = process.argv.includes("--apply");
  const { deletable, skipped, deleted, groups } = await pruneTagsFromYaml(prisma, { apply });

  if (skipped.length) {
    console.log(`Kept ${skipped.length} tag(s) absent from docs/tags.yaml:`);
    for (const { tag, reasons } of skipped) {
      console.log(`  - ${tag.name} (${tag.slug}) — ${reasons.join("; ")}`);
    }
    console.log("");
  }

  if (groups.skipped.length) {
    console.log(`Kept ${groups.skipped.length} tag group(s) absent from docs/taggroups.yaml:`);
    for (const { group, reasons } of groups.skipped) {
      console.log(`  - ${group.name} (${group.slug}) — ${reasons.join("; ")}`);
    }
    console.log("");
  }

  if (!deletable.length && !groups.deletable.length) {
    console.log("Nothing to prune.");
    return;
  }

  if (deletable.length) {
    console.log(`${apply ? "Deleted" : "Would delete"} ${deletable.length} unreferenced tag(s):`);
    for (const tag of deletable) console.log(`  - ${tag.name} (${tag.slug})`);
  }
  if (groups.deletable.length) {
    console.log(`${apply ? "Deleted" : "Would delete"} ${groups.deletable.length} empty tag group(s):`);
    for (const group of groups.deletable) console.log(`  - ${group.name} (${group.slug})`);
  }

  if (!apply) {
    console.log("\nDry run. Re-run with `-- --apply` to delete them.");
  } else {
    console.log(`\nDeleted ${deleted} tag(s), ${groups.deleted} group(s).`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
