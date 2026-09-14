// One-off: grants every ALIVE Merchant and Docker the same starting-memory
// road to the Factory that db/lib/startingMemories.js#FACTORY_ROAD now gives
// a character of either role — the catch-up for players from before that
// change landed.
//
//   node db/scripts/ops/grant-factory-road-merchant-docker.js           # dry run
//   node db/scripts/ops/grant-factory-road-merchant-docker.js --apply   # write + DM
//
// Reuses seedMemories/startingMemorySlugs rather than writing LocationVisit
// rows by hand (db/lib/locationVisits.js is the one module allowed to touch
// that table).
require("dotenv").config();
const { prisma } = require("../../index");
const { seedMemories } = require("../../lib/locationVisits");
const { startingMemorySlugs } = require("../../lib/startingMemories");
const { sendDm } = require("../../lib/dm");

const APPLY = process.argv.includes("--apply");
const DM_TEXT = "You can now see the path to the factory on your map.";
const ROLE_SLUGS = ["merchant", "docker"];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)\//)?.[1] ?? "(unparsed)";
  console.log(`DATABASE_URL host: ${host}`);
  console.log(APPLY ? "APPLY — will write LocationVisit rows and DM players" : "DRY RUN — no writes");

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE", role: { slug: { in: ROLE_SLUGS } } },
    select: {
      id: true,
      name: true,
      locationId: true,
      discordUserId: true,
      role: { select: { slug: true } },
      tags: { select: { equipped: true, tag: { select: { slug: true } } } },
    },
  });

  console.log(`${characters.length} ALIVE character(s) across ${ROLE_SLUGS.join(", ")}.`);

  const dmTargets = new Map();
  let touched = 0;

  for (const character of characters) {
    const heldSlugs = character.tags.map((ct) => ct.tag.slug);
    const slugs = startingMemorySlugs(character.role.slug, heldSlugs);

    console.log(`- ${character.name} (${character.role.slug}): seeding ${slugs.length} slug(s) (skipDuplicates protects anything already known)`);

    if (!APPLY) continue;

    await seedMemories(prisma, character, slugs);
    touched += 1;
    if (character.discordUserId) dmTargets.set(character.discordUserId, character.name);
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to write and DM.");
    return;
  }

  console.log(`\nSeeded ${touched} character(s).`);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: "system",
      actionType: "starting_memory_backfill",
      details: { roles: ROLE_SLUGS, characterCount: touched, why: "FACTORY_ROAD added to startingMemories.js" },
    },
  });

  for (const [discordUserId, name] of dmTargets) { // best-effort; a Discord outage must not undo the map grant
    await sendDm(prisma, discordUserId, DM_TEXT).catch((err) =>
      console.error(`  ! DM to ${name} failed: ${err.message}`),
    );
  }
  console.log(`DMed ${dmTargets.size} player(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
