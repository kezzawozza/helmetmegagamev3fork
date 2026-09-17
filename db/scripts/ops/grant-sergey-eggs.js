// One-off: grants Sergey Waters two Arelitz Eggs and the Cooking (Basic) skill.
//
//   node db/scripts/ops/grant-sergey-eggs.js           # dry run
//   node db/scripts/ops/grant-sergey-eggs.js --apply   # write
//
// Matches the name as a case-insensitive fragment and refuses to write unless
// exactly one character matches.
require("dotenv").config();
const { prisma } = require("../../index");
const { addToStack } = require("../../lib/tagWrites");

const APPLY = process.argv.includes("--apply");
const NAME_FRAGMENT = "Sergey Waters";
const GRANTS = [{ slug: "tinned-butter", quantity: 1 }];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)\//)?.[1] ?? "(unparsed)";
  console.log(`DATABASE_URL host: ${host}`);
  console.log(APPLY ? "APPLY — will write the grant" : "DRY RUN — no writes");

  const candidates = await prisma.character.findMany({
    where: { name: { contains: NAME_FRAGMENT, mode: "insensitive" } },
    select: { id: true, name: true, status: true },
  });
  if (candidates.length !== 1) {
    console.log(`${candidates.length} character(s) match "${NAME_FRAGMENT}":`);
    for (const c of candidates) console.log(`- ${c.name} (${c.status}) [${c.id}]`);
    console.log("Refusing to guess — need exactly one match. Nothing written.");
    return;
  }
  const character = candidates[0];
  console.log(`Target: ${character.name} (${character.status}) [${character.id}]`);

  const tags = await prisma.tag.findMany({ where: { slug: { in: GRANTS.map((g) => g.slug) } } });
  const bySlug = new Map(tags.map((t) => [t.slug, t]));
  const missing = GRANTS.filter((g) => !bySlug.has(g.slug));
  if (missing.length) {
    console.error(`Missing from the catalog: ${missing.map((g) => g.slug).join(", ")} — run npm run db:sync-tags.`);
    return;
  }

  for (const g of GRANTS) {
    const tag = bySlug.get(g.slug);
    const held = await prisma.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId: tag.id } },
      select: { quantity: true },
    });
    console.log(`- ${tag.name} x${g.quantity} (${g.slug}) — holds ${held?.quantity ?? 0} now`);
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const g of GRANTS) {
      const tag = bySlug.get(g.slug);
      await addToStack(tx, character.id, tag.id, g.quantity, {
        source: "GM_GRANT",
        stackable: tag.stackable,
      });
    }
  });

  // Deliberately writes no AuditLog row.

  console.log("Written.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
