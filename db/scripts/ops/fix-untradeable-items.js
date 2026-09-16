// One-off: every Items row that says `tradeable: false` becomes tradeable.
// db/lib/syncTags.js derives the flag for the `items` category now, but a sync
// only reaches rows docs/tags.yaml names — a tag a GM minted at /gm/dev/tags
// is not one of those, and the flower that started this was exactly that.
//
//   node db/scripts/ops/fix-untradeable-items.js           # dry run
//   node db/scripts/ops/fix-untradeable-items.js --apply   # write
//
// EPHEMERAL ROWS ARE SKIPPED, and that is the load-bearing line. A Disguise
// (db/lib/disguiseMint.js) is an Items row that is untradeable ON PURPOSE —
// an act you are wearing is not cargo — and so are the runtime mints that copy
// a source tag's flags (customCraftMint, riteEffects). The new rule lives on
// the two AUTHORING doors, the YAML sync and the GM form, and never on a mint;
// this backfill has to respect the same line or it hands out somebody's face.
//
// Prints every row by name before touching anything. Read that list.
require("dotenv").config();
const { prisma } = require("../../index");
const { TAG_CATEGORY } = require("../../lib/constants");

const APPLY = process.argv.includes("--apply");

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)\//)?.[1] ?? "(unparsed)";
  console.log(`DATABASE_URL host: ${host}`);
  console.log(APPLY ? "APPLY — will write" : "DRY RUN — no writes");
  console.log("");

  const where = { category: TAG_CATEGORY.ITEMS, tradeable: false, ephemeral: false };

  const rows = await prisma.tag.findMany({
    where,
    select: { id: true, slug: true, name: true, custom: true, weightLbs: true },
    orderBy: { name: "asc" },
  });

  // Counted but never touched, so the skip is visible rather than silent.
  const kept = await prisma.tag.count({
    where: { category: TAG_CATEGORY.ITEMS, tradeable: false, ephemeral: true },
  });
  if (kept) console.log(`Leaving ${kept} ephemeral item row(s) alone — disguises and runtime mints.\n`);

  if (!rows.length) {
    console.log("Nothing to fix.");
    return;
  }

  console.log(`${APPLY ? "Making" : "Would make"} ${rows.length} item(s) tradeable:`);
  for (const t of rows) {
    const weight = t.weightLbs == null ? "no weight" : `${t.weightLbs} lb`;
    console.log(`  - ${t.name} (${t.slug})${t.custom ? " · GM-made" : ""} — ${weight}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  const { count } = await prisma.tag.updateMany({ where, data: { tradeable: true } });
  console.log(`\nUpdated ${count} tag(s).`);

  // An untradeable item was weightless by the old rule, so some of these have
  // no weight to count against a carry cap. Nothing here guesses one — a
  // weight is priced off the band table by a person (CARRY.md §2).
  const weightless = rows.filter((t) => t.weightLbs == null);
  if (weightless.length) {
    console.log(`\n${weightless.length} of them carry no weight and now count as 0 lb:`);
    for (const t of weightless) console.log(`  - ${t.name} (${t.slug})`);
    console.log("Price each off CARRY.md §2's band table at /gm/dev/tags.");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
