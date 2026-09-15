// The Discord mirror from a terminal.
//
//   npm run db:mirror             # what does not match, and what would be done
//   npm run db:mirror -- --full   # plus the per-member sweeps
//   npm run db:mirror -- --json   # the whole result, for a script to read
//   npm run db:mirror -- --apply  # actually do it
//
// Without --apply it reads and reports and writes nothing. WITH it, it creates
// roles and channels, renames and reparents them, rewrites room starters and
// pinned anchors — so .claude/hooks/db-guard.py holds it against the live
// database until a human has said yes.
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
          ran: result.ran,
          deferred: result.deferred,
          findings: result.findings,
          failures: result.failures,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (result.ops.length === 0 && result.findings.length === 0) {
    console.log(`mirror (${scope}): Discord matches the database — nothing to do.`);
    return;
  }

  console.log(
    `mirror (${scope}, ${apply ? "apply" : "dry run"}): ${result.ops.length} op(s), ` +
      `${result.findings.length} finding(s)`,
  );
  const statusById = new Map(result.ran.map((r) => [`${r.order}:${r.targetId}`, r.status]));
  for (const op of result.ops) {
    const status = statusById.get(`${op.order}:${op.targetId}`) ?? "deferred";
    console.log(
      `  ${String(op.order).padStart(3)} [${op.kind}] ${op.targetId ?? op.targetType}: ${op.reason}` +
        (apply ? ` — ${status}` : ""),
    );
  }
  if (result.deferred.length > 0) {
    console.log(`  ${result.deferred.length} op(s) deferred: the Discord circuit breaker is open.`);
  }
  for (const f of result.findings) {
    console.log(`  ! [${f.check}] ${f.target}: ${f.problem}${f.repaired ? " — repaired" : ""}`);
  }
  if (result.failures.length > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
