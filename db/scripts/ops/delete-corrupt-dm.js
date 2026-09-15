// One-off: the DM sent by revoke-brigand-corrupt.js was badly worded. Deletes the actual
// Discord message for both players and removes the DirectMessage log row. No replacement
// is sent here — that's a separate call if wanted.
//
//   node db/scripts/ops/delete-corrupt-dm.js           # dry run
//   node db/scripts/ops/delete-corrupt-dm.js --apply   # delete for real
require("dotenv").config();
const { prisma } = require("../../index");
const { createDmChannel, deleteMessage } = require("../../lib/discordRest");

const APPLY = process.argv.includes("--apply");
const DISCORD_USER_IDS = ["248925965508411394", "298080075604033538"];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)\//)?.[1] ?? "(unparsed)";
  console.log(`DATABASE_URL host: ${host}`);
  console.log(APPLY ? "APPLY — will delete the Discord message and log row" : "DRY RUN — no writes");

  const rows = await prisma.directMessage.findMany({
    where: {
      discordUserId: { in: DISCORD_USER_IDS },
      content: { contains: "a Brigand shouldn" },
    },
  });

  for (const row of rows) {
    console.log(`\n${row.discordUserId} — DirectMessage ${row.id}, message ${row.discordMessageId}`);
    if (!APPLY) {
      console.log("  would: delete Discord message, delete DirectMessage row");
      continue;
    }
    if (row.discordMessageId) {
      try {
        const channel = await createDmChannel(row.discordUserId);
        await deleteMessage(channel.id, row.discordMessageId);
        console.log("  Discord message deleted");
      } catch (err) {
        console.error("  Discord delete FAILED:", err?.message ?? err);
      }
    } else {
      console.log("  no discordMessageId on the row, skipping Discord delete");
    }
    await prisma.directMessage.delete({ where: { id: row.id } });
    console.log("  DirectMessage row deleted");
  }
  if (rows.length === 0) console.log("\nno matching rows found");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
