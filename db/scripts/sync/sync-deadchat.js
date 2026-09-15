// Provisioning + reconciliation for DEADCHAT (db/lib/deadchat.js),
// `npm run db:sync-deadchat`.
//
// A thin wrapper over the Discord mirror now: the Beyond category, the channel,
// its topic, the @everyone deny and the GM's read-but-never-speak mask are
// desired-state entries in db/lib/discordMirror/desired.js. Safe to re-run: the
// channel is adopted by name before anything is created.
//
// It touches no per-member seat. Those are written when somebody dies and taken
// back when they live again; the mirror's sweeps reconcile the set.
require("dotenv").config();
const { prisma } = require("../../index");
const { runDiscordMirror } = require("../../lib/discordMirror");

async function main() {
  const result = await runDiscordMirror(prisma, {
    apply: true,
    scope: "structure",
    targets: [{ targetType: "deadchat" }],
  });

  if (result.ops.length === 0) console.log("#deadchat already matches the database.");
  for (const op of result.ran) console.log(`  [${op.kind}] ${op.targetId}: ${op.reason} — ${op.status}`);
  for (const f of result.findings) console.log(`  ! [${f.check}] ${f.target}: ${f.problem}`);
  if (result.failures.length > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
