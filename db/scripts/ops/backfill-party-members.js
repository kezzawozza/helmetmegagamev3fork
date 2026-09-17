// One-shot: reconcile the two currently-live PartyThreads whose Discord adds
// silently 403'd before the per-member #party overwrite existed. Reads every
// PartyThreadMember, stamps a per-member overwrite on the parent, then invites
// the mirrored ones to their party thread. Idempotent — putChannelOverwrite
// and addThreadMember are both fine to re-run.
//
// `npm run db:backfill-party-members` to preview, `-- --apply` to run for real.
require("dotenv").config();
const { prisma } = require("../../index");
const { openPartyChannelTo } = require("../../lib/partyChat");
const { addThreadMember } = require("../../lib/discordRest");

async function main() {
  const apply = process.argv.includes("--apply");
  const parties = await prisma.partyThread.findMany({
    select: {
      id: true,
      threadId: true,
      name: true,
      creatorCharacterId: true,
      members: { select: { characterId: true } },
    },
  });
  console.log(`Found ${parties.length} party thread(s).`);
  if (parties.length === 0) return;

  for (const party of parties) {
    console.log(`\n"${party.name}" (thread ${party.threadId})`);
    const memberIds = party.members.map((m) => m.characterId);
    if (memberIds.length === 0) {
      console.log("  no members");
      continue;
    }
    const characters = await prisma.character.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, name: true, discordUserId: true, discordMirrored: true },
    });
    for (const c of characters) {
      const mirrored = Boolean(c.discordUserId && c.discordMirrored);
      const tag = mirrored ? "MIRRORED" : "web-only";
      console.log(`  - ${c.name} [${tag}] ${c.discordUserId ?? ""}`);
      if (!apply) continue;
      if (!mirrored) continue;
      const opened = await openPartyChannelTo(prisma, c.discordUserId);
      console.log(`      opened #party seat: ${opened}`);
      try {
        await addThreadMember(party.threadId, c.discordUserId);
        console.log("      added to thread: ok");
      } catch (err) {
        console.log(`      added to thread: FAILED ${err.message ?? err}`);
      }
    }
  }
  if (!apply) console.log("\nDRY RUN — pass -- --apply to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
