// Read-only report: ALIVE characters with no activity or last active turn 1,
// plus anyone who has left the guild. Prints only; makes no writes. Buckets
// live in db/lib/inactivity.js, shared with the Dev Panel's Nudge button so
// the two can't disagree about who counts as inactive.
//
//   npm run db:report-inactive-characters
require("dotenv").config();
const { prisma } = require("../../index");
const { inactiveCharacters } = require("../../lib/inactivity");

async function main() {
  const { turn, leftGuild, neverActive, sinceDayOne } = await inactiveCharacters(prisma);
  if (turn == null) {
    console.log("No turns found — nothing to report against.");
    return;
  }

  console.log(`Current/most recent turn: ${turn}\n`);

  console.log(`Left the Discord guild (${leftGuild.length}):`);
  for (const c of leftGuild) {
    console.log(`  - ${c.name} (${c.discordUserId}) — left ${c.leftGuildAt.toISOString()}`);
  }

  console.log(`\nNever recorded any activity — clock never stamped (${neverActive.length}):`);
  for (const c of neverActive) {
    console.log(`  - ${c.name} (${c.discordUserId})`);
  }

  console.log(`\nLast active on turn 1 — hasn't posted since day one (${sinceDayOne.length}):`);
  for (const c of sinceDayOne) {
    console.log(`  - ${c.name} (${c.discordUserId}) — idle ${turn - 1} turn(s)`);
  }

  console.log(
    "\nThis is a read-only report. Review these characters at /gm/players before taking any action — " +
      "nothing here has been modified or deleted.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
