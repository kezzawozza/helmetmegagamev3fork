// One-shot backfill for the party-chat deploy: every ALIVE character with
// somebody escorted needs a PartyThread, and every currently-open thread's
// members need the per-member #party overwrite stamp. syncPartyMembership does
// exactly this per leader — this script just walks the escort chain and calls
// it for each distinct leader.
//
// Idempotent. Safe to re-run: syncPartyMembership creates missing threads,
// diffs member rows, and skips no-op writes.
//
// `npm run db:backfill-party-members` to preview, `-- --apply` to run for real.
require("dotenv").config();
const { prisma } = require("../../index");
const { syncPartyMembership } = require("../../lib/partyChat");

async function leadersWithParties() {
  const rows = await prisma.character.findMany({
    where: { escortedById: { not: null }, status: "ALIVE" },
    select: { escortedById: true },
  });
  return [...new Set(rows.map((r) => r.escortedById).filter(Boolean))];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const leaderIds = await leadersWithParties();
  console.log(`Found ${leaderIds.length} leader(s) with a live party.`);

  for (const leaderId of leaderIds) {
    const leader = await prisma.character.findUnique({
      where: { id: leaderId },
      select: {
        id: true,
        name: true,
        discordUserId: true,
        discordMirrored: true,
      },
    });
    const party = await prisma.character.findMany({
      where: { escortedById: leaderId },
      select: { name: true, discordMirrored: true },
    });
    const existing = await prisma.partyThread.findUnique({
      where: { creatorCharacterId: leaderId },
      select: { threadId: true, name: true, members: { select: { characterId: true } } },
    });
    console.log(
      `\n${leader?.name}${leader?.discordMirrored ? "" : " [web]"} — carrying ${party.length}: ${party.map((p) => p.name).join(", ")}`,
    );
    console.log(`  thread: ${existing ? `${existing.name} (${existing.threadId}, ${existing.members.length} row(s))` : "NONE"}`);
    if (!apply) continue;

    try {
      const thread = await syncPartyMembership(prisma, leaderId);
      console.log(`  synced: ${thread ? `${thread.name} / ${thread.threadId}` : "no-op"}`);
    } catch (err) {
      console.error(`  SYNC FAILED:`, err.message ?? err);
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
