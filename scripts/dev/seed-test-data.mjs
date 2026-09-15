// A couple of throwaway characters and audit rows to click around with
// locally — enough to test a GM page's filters without needing real turns,
// real players, or a real Discord guild. Everything this writes is tagged so
// it's obvious at a glance and trivial to remove; see cleanup() below.
//
// Refuses to run against anything that isn't a local database, on its own,
// independent of .claude/hooks/db-guard.py — this writes fake rows into
// whatever DATABASE_URL points at, and that must never be the live one.
//
//   npm run dev:seed             add the seed characters + audit rows
//   npm run dev:seed -- --clean  remove them again

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SEED_PREFIX = "local-seed-";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const path of [resolve(REPO_ROOT, "web/.env.local"), resolve(REPO_ROOT, ".env")]) {
    try {
      const m = readFileSync(path, "utf8").match(/^DATABASE_URL\s*=\s*(.*)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      // try the next one
    }
  }
  return "";
}

async function cleanup(prisma) {
  const { count: logs } = await prisma.auditLog.deleteMany({
    where: { actorDiscordUserId: { startsWith: SEED_PREFIX } },
  });
  const { count: chars } = await prisma.character.deleteMany({
    where: { discordUserId: { startsWith: SEED_PREFIX } },
  });
  console.log(`Removed ${logs} seeded AuditLog row(s) and ${chars} seeded Character(s).`);
}

async function seed(prisma) {
  const zone = await prisma.zone.findFirst({ where: { kind: { not: "CAVE_GROUP" } } });
  if (!zone) {
    throw new Error("No Zone rows found — run `npm run db:import-zones -- --apply` first (npm run dev:setup does this for you).");
  }
  const location = await prisma.location.findFirst({ where: { zoneId: zone.id } });
  if (!location) {
    throw new Error(`Zone "${zone.name}" has no Location — did the zones sync run to completion?`);
  }

  const c1 = await prisma.character.create({
    data: {
      discordUserId: `${SEED_PREFIX}1`,
      firstName: "Seed",
      lastName: "Alpha",
      name: "Seed Alpha (local)",
      status: "ALIVE",
      zoneId: zone.id,
      locationId: location.id,
    },
  });
  const c2 = await prisma.character.create({
    data: {
      discordUserId: `${SEED_PREFIX}2`,
      firstName: "Seed",
      lastName: "Beta",
      name: "Seed Beta (local)",
      status: "ALIVE",
      zoneId: zone.id,
      locationId: location.id,
    },
  });

  // Two different action types on two different targets — enough to test,
  // e.g., /gm/audit's Action type + Character filters together.
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: SEED_PREFIX + "gm",
      actionType: "gm_transfer_resources",
      targetCharacterId: c1.id,
      details: { amount: 10 },
    },
  });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: SEED_PREFIX + "gm",
      actionType: "gm_character_killed",
      targetCharacterId: c2.id,
      details: {},
    },
  });

  console.log(`Seeded 2 characters (${c1.name}, ${c2.name}) at ${location.name}, ${zone.name}, and 2 AuditLog rows.`);
  console.log("Clean them up any time with: npm run dev:seed -- --clean");
}

async function main() {
  // Settle DATABASE_URL BEFORE asserting on it. The variable is what decides
  // where a query lands, not the file — an exported DATABASE_URL beats every
  // .env, silently, which is how a scratch script emptied the live database on
  // 2026-09-09. So resolve it, publish it, then check the thing that is
  // actually in force.
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = loadDatabaseUrl();

  const require = createRequire(import.meta.url);
  // The shared assertion (db/lib/localDatabase.js), which used to be a private
  // copy in this file. Every throwaway harness that writes should call it.
  const { requireLocalDatabase } = require("../../db/lib/localDatabase.js");
  requireLocalDatabase("The dev seed script");

  const { prisma } = require("@lifeweb/db");

  try {
    if (process.argv.includes("--clean")) await cleanup(prisma);
    else await seed(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\ndev:seed failed:", err.message ?? err);
  process.exit(1);
});
