// Provisioning + reconciliation for the special channels registry
// (#cerberon/#27.065 and siblings), `npm run db:sync-narrowcast-channels`.
//
// A thin wrapper over the Discord mirror now: the radio category, each net's
// channel, its topic and slowmode, the @everyone deny, the GM and spectator
// seats and the static zone-role view grants are all desired-state entries in
// db/lib/discordMirror/desired.js, so this runs the mirror scoped to them
// rather than carrying its own provisioning loop. Safe to re-run — the mirror
// adopts a same-named channel before it would ever create a second.
//
// Run it AFTER db:import-zones and db:mirror so the zone roles it grants view to exist.
require("dotenv").config();
const { prisma } = require("../../index");
const { runDiscordMirror } = require("../../lib/discordMirror");

async function main() {
  const result = await runDiscordMirror(prisma, {
    apply: true,
    scope: "structure",
    targets: [{ targetType: "special" }],
  });

  if (result.ops.length === 0) {
    console.log("special channels: already match the database.");
  } else {
    for (const op of result.ran) console.log(`  [${op.kind}] ${op.targetId}: ${op.reason} — ${op.status}`);
  }
  for (const f of result.findings) console.log(`  ! [${f.check}] ${f.target}: ${f.problem}`);
  console.log("special channels reconciled");
  if (result.failures.length > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
