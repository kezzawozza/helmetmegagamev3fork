// One-off: grants Repent the full human organ set an untouched corpse gives
// up to a single Butcher.
//
//   node db/scripts/ops/grant-repent-organs.js           # dry run
//   node db/scripts/ops/grant-repent-organs.js --apply   # write
//
// Matches the name as a case-insensitive fragment and refuses to write
// unless exactly one character matches. The grant list comes from
// harvestableOrgans([]) (db/lib/mutilate.js) rather than re-typing it.
require("dotenv").config();
const { prisma } = require("../../index");
const { addToStack } = require("../../lib/tagWrites");
const { harvestableOrgans } = require("../../lib/mutilate");

const APPLY = process.argv.includes("--apply");
const NAME_FRAGMENT = "Repent";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)\//)?.[1] ?? "(unparsed)";
  console.log(`DATABASE_URL host: ${host}`);
  console.log(APPLY ? "APPLY — will write the organ grant" : "DRY RUN — no writes");

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

  const harvest = harvestableOrgans([]);
  const itemTags = await prisma.tag.findMany({
    where: { slug: { in: harvest.map((h) => h.itemSlug) } },
  });
  const tagBySlug = new Map(itemTags.map((t) => [t.slug, t]));

  const missing = harvest.filter((h) => !tagBySlug.has(h.itemSlug));
  if (missing.length) {
    console.error(
      `Missing from the catalog: ${missing.map((h) => h.itemSlug).join(", ")} — run npm run db:sync-tags.`,
    );
    return;
  }

  for (const h of harvest) {
    console.log(`- ${h.label} x${h.quantity} (${h.itemSlug})`);
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const h of harvest) {
      const tag = tagBySlug.get(h.itemSlug);
      await addToStack(tx, character.id, tag.id, h.quantity, {
        source: "GM_GRANT",
        stackable: tag.stackable,
      });
    }
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: "system",
      actionType: "organ_grant_repent",
      targetCharacterId: character.id,
      details: {
        characterId: character.id,
        granted: harvest.map((h) => ({ part: h.part, quantity: h.quantity })),
      },
    },
  });

  console.log(`\nGranted the full organ set to ${character.name}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
