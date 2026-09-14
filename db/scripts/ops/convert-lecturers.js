// One-off: retire Teaching (Lecturing) (docs/systemdocs/LESSONS.md §6).
//
// The 2026-09-14 teaching rework deleted the Lecturing rung from
// docs/tags.yaml, but db:sync-tags is upsert-only, so anyone who already holds
// it keeps holding it. Lecturing is Teaching's child tier, which means a holder
// has the Lecturing row and NOT the Teaching one — leaving them alone would
// quietly demote them to an untrained teacher. So each row is re-pointed at
// plain Teaching, or deleted outright if they somehow hold both.
//
// Dry run unless given `-- --apply`, same as db:prune-tags. Once it has run
// against the live database, `npm run db:prune-tags -- --apply` deletes the
// orphaned tag and this script can be deleted with it.
require("dotenv").config();
const { prisma } = require("../../index");
const { TEACHING_SLUG } = require("../../lib/constants");

const LECTURING_SLUG = "teaching-lecturing";

async function main() {
  const apply = process.argv.includes("--apply");

  const [lecturing, teaching] = await Promise.all([
    prisma.tag.findUnique({ where: { slug: LECTURING_SLUG }, select: { id: true } }),
    prisma.tag.findUnique({ where: { slug: TEACHING_SLUG }, select: { id: true } }),
  ]);
  if (!lecturing) {
    console.log(`No ${LECTURING_SLUG} tag in this database. Nothing to convert.`);
    return;
  }
  if (!teaching) {
    console.error(`No ${TEACHING_SLUG} tag in this database — run db:sync-tags first.`);
    process.exitCode = 1;
    return;
  }

  const rows = await prisma.characterTag.findMany({
    where: { tagId: lecturing.id },
    select: {
      id: true,
      characterId: true,
      character: { select: { name: true, status: true } },
    },
  });
  if (!rows.length) {
    console.log("Nobody holds Teaching (Lecturing). Nothing to convert.");
    return;
  }

  // Who already holds plain Teaching as well? Their Lecturing row is a
  // duplicate and goes, rather than colliding on @@unique([characterId, tagId]).
  const alreadyTeaching = new Set(
    (
      await prisma.characterTag.findMany({
        where: {
          tagId: teaching.id,
          characterId: { in: rows.map((r) => r.characterId) },
        },
        select: { characterId: true },
      })
    ).map((r) => r.characterId),
  );

  const converting = rows.filter((r) => !alreadyTeaching.has(r.characterId));
  const dropping = rows.filter((r) => alreadyTeaching.has(r.characterId));

  const label = (r) =>
    `${r.character?.name ?? "(nameless)"} [${r.character?.status ?? "?"}]`;
  if (converting.length) {
    console.log(
      `${apply ? "Converted" : "Would convert"} ${converting.length} row(s) to Teaching:`,
    );
    for (const r of converting) console.log(`  - ${label(r)}`);
  }
  if (dropping.length) {
    console.log(
      `${apply ? "Deleted" : "Would delete"} ${dropping.length} duplicate row(s) (already hold Teaching):`,
    );
    for (const r of dropping) console.log(`  - ${label(r)}`);
  }

  if (!apply) {
    console.log("\nDry run. Re-run with `-- --apply` to write them.");
    return;
  }

  await prisma.$transaction([
    prisma.characterTag.updateMany({
      where: { id: { in: converting.map((r) => r.id) } },
      data: { tagId: teaching.id },
    }),
    prisma.characterTag.deleteMany({
      where: { id: { in: dropping.map((r) => r.id) } },
    }),
  ]);
  console.log(
    `\nConverted ${converting.length} row(s), deleted ${dropping.length}. Now run \`npm run db:prune-tags -- --apply\`.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
