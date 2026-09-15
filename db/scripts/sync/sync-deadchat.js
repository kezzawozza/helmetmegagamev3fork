// Provisioning + reconciliation for DEADCHAT (db/lib/deadchat.js),
// `npm run db:sync-deadchat`. Safe to re-run: the channel is recovered by name
// before anything is created, and the overwrites below are reconciled every run.
//
// It touches no per-member seat. Those are written when somebody dies and taken
// back when they live again; the channel doctor reconciles the set.
require("dotenv").config();
const { prisma } = require("../../index");
const { ensureDeadchatChannel } = require("../../lib/deadchat");

async function main() {
  const { channelId, provisioned } = await ensureDeadchatChannel(prisma);
  console.log(provisioned ? `provisioned #deadchat (${channelId})` : `#deadchat reconciled (${channelId})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
