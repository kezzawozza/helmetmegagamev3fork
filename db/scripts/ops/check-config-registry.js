#!/usr/bin/env node
// Diffs db/lib/gameConfigFields.js against the GameConfig model in the
// generated Prisma client. A column with no registry entry is unreachable
// from /gm/dev; a registry entry with no column throws on save. Either way the
// push should not go out. Run by scripts/push.sh; `npm run db:check-config`.
const { Prisma } = require("@prisma/client");
const { FIELDS, INTERNAL_KEYS } = require("../../lib/gameConfigFields");

const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "GameConfig");
if (!model) {
  console.error("check-config: no GameConfig model in the generated client — run npm run db:generate");
  process.exit(1);
}
// "scalar" alone misses an ENUM column, which is just as real a column and just as settable from the form — GameConfig.gameMode
// is one. Relations are what this is meant to skip, and they are neither kind.
const columns = new Set(
  model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum").map((f) => f.name),
);
const declared = new Set([...FIELDS.map((f) => f.key), ...INTERNAL_KEYS]);

const missing = [...columns].filter((c) => !declared.has(c));
const stale = [...declared].filter((k) => !columns.has(k));

if (missing.length || stale.length) {
  if (missing.length) console.error(`GameConfig columns with no registry entry: ${missing.join(", ")}`);
  if (stale.length) console.error(`Registry entries with no GameConfig column: ${stale.join(", ")}`);
  process.exit(1);
}
console.log(`check-config: ${FIELDS.length} knobs, ${INTERNAL_KEYS.length} internal, in sync.`);
