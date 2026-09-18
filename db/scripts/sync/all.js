// Every YAML master into the database, in the one order that works: tags
// before roles, desires, documents, then a structure mirror pass to pick up
// whatever any of that touched (narrowcast channels and Deadchat included —
// the mirror provisions both now). Same sequence as wipeGameData's re-sync.
//
//   npm run db:sync
//
// Zones are no longer part of this run: docs/zones.yaml is a one-shot
// additive importer now (`npm run db:import-zones`), not a routine sync.
// sync-documents deletes rows dropped from its YAML; see SYNC.md §1 before
// running against a live game.
require("dotenv").config();
const {
  prisma,
  syncTagsFromYaml,
  syncRolesFromYaml,
  syncDesiresFromYaml,
  syncDocumentsFromYaml,
} = require("../../index");
const { runDiscordMirror } = require("../../lib/discordMirror");

async function main() {
  if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_GUILD_ID) {
    console.error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
    process.exit(1);
  }
  const steps = [
    ["tags", async () => {
      const s = await syncTagsFromYaml(prisma);
      return `groups +${s.groupsCreated}/~${s.groupsUpdated}, tags +${s.tagsCreated}/~${s.tagsUpdated}, links ${s.linksUpdated}`;
    }],
    ["roles", async () => {
      const s = await syncRolesFromYaml(prisma);
      return `roles +${s.rolesCreated}/~${s.rolesUpdated}` +
        (s.rolesPruned.length ? `, pruned ${s.rolesPruned.join(", ")}` : "");
    }],
    ["desires", async () => {
      const s = await syncDesiresFromYaml(prisma);
      return `+${s.created}/~${s.updated}, retired ${s.retired}, unretired ${s.unretired}`;
    }],
    ["documents", async () => {
      const s = await syncDocumentsFromYaml(prisma);
      return `+${s.created}/~${s.updated}` + (s.pruned.length ? `, pruned ${s.pruned.join(", ")}` : "");
    }],
    ["discord mirror", async () => {
      const s = await runDiscordMirror(prisma, { apply: true, scope: "structure" });
      return `${s.ops.length} op(s), ${s.repaired} repaired`;
    }],
  ];

  for (const [name, run] of steps) {
    const started = Date.now();
    const line = await run();
    console.log(`${name.padEnd(20)} ${line}  (${Date.now() - started} ms)`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
