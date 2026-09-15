// The Discord mirror from a terminal. It only ever looks.
//
//   npm run db:mirror            # what does not match, and what would be done
//   npm run db:mirror -- --full  # plus the delegated per-member sweeps
//   npm run db:mirror -- --json  # the whole result, for a script to read
//
// `--apply` is accepted and does nothing yet: Phase 0 ships the reconciler as a
// reader so it can be checked against the existing sync before it is allowed to
// touch the guild. Run it against a database db:sync-zones has just finished
// with and it should print "nothing to do" — that is the proof the two agree.
require("dotenv").config();
const { prisma } = require("../../index");
const { runDiscordMirror } = require("../../lib/discordMirror");

async function main() {
  const apply = process.argv.includes("--apply");
  const scope = process.argv.includes("--full") ? "full" : "structure";
  const asJson = process.argv.includes("--json");

  const result = await runDiscordMirror(prisma, { apply, scope });

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          scope: result.scope,
          apply: result.apply,
          applied: result.applied,
          ops: result.ops.map((o) => ({
            order: o.order,
            kind: o.kind,
            targetType: o.targetType,
            targetId: o.targetId,
            reason: o.reason,
          })),
          findings: result.findings,
          failures: result.failures,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (apply) console.log("mirror: --apply is inert until Phase 1. This was a dry run.");

  if (result.ops.length === 0 && result.findings.length === 0) {
    console.log(`mirror (${scope}): Discord matches the database — nothing to do.`);
    return;
  }

  console.log(`mirror (${scope}, dry run): ${result.ops.length} op(s), ${result.findings.length} finding(s)`);
  for (const op of result.ops) {
    console.log(`  ${String(op.order).padStart(3)} [${op.kind}] ${op.targetId ?? op.targetType}: ${op.reason}`);
  }
  for (const f of result.findings) {
    console.log(`  ! [${f.check}] ${f.target}: ${f.problem}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
