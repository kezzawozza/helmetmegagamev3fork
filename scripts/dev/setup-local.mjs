// Bootstraps a fully local dev stack: a local Postgres database, migrated
// and seeded from the YAML masters, with LOCAL_MODE on so nothing needs a
// real Discord bot token, guild, or GM role (LOCAL-DEV.md). Safe to re-run:
// every step is idempotent and it never touches the live database.
//
//   npm run dev:setup

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENV_PATH = resolve(REPO_ROOT, ".env");
const DEFAULT_DATABASE_URL = "postgresql://localhost:5432/bascinet";

function log(msg) {
  console.log(`\n== ${msg}`);
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function ensureEnv() { // never overwrites a value already there
  const existing = readEnvFile(ENV_PATH);
  const additions = {};

  if (!existing.DATABASE_URL) additions.DATABASE_URL = DEFAULT_DATABASE_URL;
  if (!existing.LOCAL_MODE) additions.LOCAL_MODE = "true";
  if (!existing.DISCORD_TOKEN) additions.DISCORD_TOKEN = "local";
  if (!existing.DISCORD_GUILD_ID) additions.DISCORD_GUILD_ID = "local";
  if (!existing.AUTH_SECRET) additions.AUTH_SECRET = randomBytes(32).toString("base64");

  if (Object.keys(additions).length === 0) {
    log(".env already has DATABASE_URL, LOCAL_MODE, DISCORD_TOKEN/GUILD_ID and AUTH_SECRET — leaving it alone");
  } else {
    log(`Writing ${existsSync(ENV_PATH) ? "additions to" : "a new"} .env`);
    const lines = Object.entries(additions).map(([k, v]) => `${k}="${v}"`);
    const sep = existsSync(ENV_PATH) ? "\n\n# Added by npm run dev:setup\n" : "";
    writeFileSync(ENV_PATH, (existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "") + sep + lines.join("\n") + "\n");
    for (const k of Object.keys(additions)) console.log(`  + ${k}`);
  }

  return { ...existing, ...readEnvFile(ENV_PATH) };
}

// Symlinks so Prisma CLI, the bot, and Next.js all see the exact same file
// rather than three copies that can drift.
function ensureSymlink(fromRelative, toRelative) {
  const from = resolve(REPO_ROOT, fromRelative);
  const to = resolve(REPO_ROOT, toRelative);
  if (existsSync(from)) {
    try {
      const real = execFileSync("readlink", [from]).toString().trim();
      if (resolve(dirname(from), real) === to) return; // already correct
    } catch {
      console.log(`  ! ${fromRelative} already exists and isn't our symlink — leaving it alone`);
      return;
    }
    unlinkSync(from);
  }
  mkdirSync(dirname(from), { recursive: true });
  symlinkSync(to, from);
  console.log(`  + ${fromRelative} -> ${toRelative}`);
}

function ensureDatabase(databaseUrl) {
  log("Ensuring the local database exists");
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    console.log(`  ! DATABASE_URL isn't a parseable URL (${databaseUrl}) — skipping createdb, migrate will report the real error`);
    return;
  }
  if (!/^(localhost|127\.0\.0\.1|::1)$/.test(url.hostname)) {
    console.log(`  ! DATABASE_URL's host is "${url.hostname}", not localhost — not running createdb against something that isn't ours`);
    return;
  }
  const dbName = url.pathname.replace(/^\//, "") || "bascinet";
  try {
    execFileSync("createdb", [dbName], { stdio: "pipe" });
    console.log(`  + created database "${dbName}"`);
  } catch (err) {
    const msg = err.stderr?.toString() ?? err.message;
    if (/already exists/.test(msg)) {
      console.log(`  = database "${dbName}" already exists`);
    } else {
      console.log(`  ! couldn't run createdb: ${msg.trim()}`);
      console.log(
        "    Install Postgres and make sure it's running, then re-run this script.\n" +
          "    macOS: Postgres.app (postgresapp.com) or `brew install postgresql@16 && brew services start postgresql@16`\n" +
          "    Linux: your package manager's postgresql-server, then `sudo -u postgres createuser -s $USER`\n" +
          `    Or point DATABASE_URL in .env at whatever Postgres you already have.`,
      );
      process.exit(1);
    }
  }
}

function run(label, cmd) {
  log(label);
  execSync(cmd, { cwd: REPO_ROOT, stdio: "inherit", env: process.env });
}

async function main() {
  const env = ensureEnv();
  for (const k of ["DATABASE_URL", "LOCAL_MODE", "DISCORD_TOKEN", "DISCORD_GUILD_ID", "AUTH_SECRET"]) {
    if (env[k]) process.env[k] = env[k];
  }

  log("Linking web/.env.local, db/prisma/.env, bot/.env to the root .env");
  ensureSymlink("web/.env.local", ".env");
  ensureSymlink("db/prisma/.env", ".env");
  ensureSymlink("bot/.env", ".env");

  ensureDatabase(process.env.DATABASE_URL);

  run("Generating the Prisma client", "npm run db:generate");
  run("Applying migrations (prisma migrate deploy — non-interactive, no reset prompt)", "npm run db:migrate:deploy");
  // Zones are no longer part of db:sync (docs/zones.yaml is a one-shot
  // additive importer now) — import them first, so the tags/roles/desires
  // sync below has zone and location slugs to validate against. Tags come
  // first because a Location's `structures:` block resolves tag slugs at
  // import time (SYNC.md).
  run("Syncing tags from the YAML master", "npm run db:sync-tags");
  run("Importing the starting zones, locations and rooms", "npm run db:import-zones -- --apply");
  run(
    "Syncing roles, desires, documents, labor drops, then mirroring to Discord",
    "npm run db:sync",
  );

  log("Done");
  console.log(
    "\nNext:\n" +
      "  npm run dev:web                        start the app\n" +
      "  npm run dev:seed                       a couple of throwaway characters + audit rows to test against\n" +
      "  node scripts/dev/session.mjs --gm      print a session cookie for a local superadmin\n" +
      "  npm run dev:check -- --gm /gm/audit    load a GM page headlessly and check it actually rendered\n" +
      "\nSee docs/systemdocs/LOCAL-DEV.md for what LOCAL_MODE does and doesn't fake.\n",
  );
}

main().catch((err) => {
  console.error("\nsetup-local failed:", err.message ?? err);
  process.exit(1);
});
