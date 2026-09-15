// One-off: replacement DM for the deleted, badly worded Corrupt notice
// (see delete-corrupt-dm.js). Same two players.
//
//   node db/scripts/ops/send-corrupt-apology-dm.js           # dry run
//   node db/scripts/ops/send-corrupt-apology-dm.js --apply   # send for real
require("dotenv").config();
const { prisma } = require("../../index");
const { sendDm } = require("../../lib/dm");
const { DM_KIND } = require("../../lib/dmKinds");

const APPLY = process.argv.includes("--apply");
const DISCORD_USER_IDS = ["248925965508411394", "298080075604033538"];
const DM_TEXT = "Sorry, corrupt was removed from your sheet and the bug was fixed. It's a cerberon only tag.";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)\//)?.[1] ?? "(unparsed)";
  console.log(`DATABASE_URL host: ${host}`);
  console.log(APPLY ? "APPLY — will send the DM" : "DRY RUN — no sends");

  for (const discordUserId of DISCORD_USER_IDS) {
    console.log(`\n${discordUserId}`);
    if (!APPLY) {
      console.log("  would send:", DM_TEXT);
      continue;
    }
    try {
      await sendDm(prisma, discordUserId, DM_TEXT, { kind: DM_KIND.CONVERSATION });
      console.log("  DM sent");
    } catch (err) {
      console.error("  DM FAILED:", err?.message ?? err);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
