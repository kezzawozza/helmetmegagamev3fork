// Every YAML master into the database, in the one order that works: zones
// first, narrowcast channels, tags before roles, desires, documents, labor
// drops last. Same sequence as wipeGameData's re-sync.
//
//   npm run db:sync                    # all seven
//
// sync-zones, sync-documents and sync-labor-drops delete rows dropped from
// their YAML; see SYNC.md §1 before running against a live game.
require("dotenv").config();
const {
  prisma,
  syncZonesFromYaml,
  syncSpecialChannels,
  syncTagsFromYaml,
  syncRolesFromYaml,
  syncDesiresFromYaml,
  syncDocumentsFromYaml,
  syncLaborDropsFromYaml,
} = require("../../index");

async function main() {
  if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_GUILD_ID) {
    console.error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
    process.exit(1);
  }
  const steps = [
    ["zones", async () => {
      const s = await syncZonesFromYaml(prisma);
      return `created ${s.zonesCreated}, updated ${s.zonesUpdated}, provisioned ${s.provisioned.length}, reconciled ${s.reconciled}`;
    }],
    ["narrowcast channels", async () => {
      const s = await syncSpecialChannels(prisma);
      return `provisioned ${s.provisioned.length}, view grants ${s.roleGrants}`;
    }],
    ["tags", async () => {
      const s = await syncTagsFromYaml(prisma);
      return `groups +${s.groupsCreated}/~${s.groupsUpdated}, tags +${s.tagsCreated}/~${s.tagsUpdated}, links ${s.linksUpdated}`;
    }],
    ["roles", async () => {
      const s = await syncRolesFromYaml(prisma);
      const pruned = [...s.rolesPruned, ...s.factionsPruned];
      return `factions +${s.factionsCreated}/~${s.factionsUpdated}, roles +${s.rolesCreated}/~${s.rolesUpdated}` +
        (pruned.length ? `, pruned ${pruned.join(", ")}` : "");
    }],
    ["desires", async () => {
      const s = await syncDesiresFromYaml(prisma);
      return `+${s.created}/~${s.updated}, retired ${s.retired}, unretired ${s.unretired}`;
    }],
    ["documents", async () => {
      const s = await syncDocumentsFromYaml(prisma);
      return `+${s.created}/~${s.updated}` + (s.pruned.length ? `, pruned ${s.pruned.join(", ")}` : "");
    }],
    ["labor drops", async () => {
      const s = await syncLaborDropsFromYaml(prisma);
      return `${s.total} options`;
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
