// Mint a valid Auth.js session cookie for local development. The web app has
// exactly one auth provider (Discord), so `next dev` can start but never
// render a page without one. Sessions are JWTs signed with AUTH_SECRET
// (already in web/.env.local), minted with the same encode() the app itself
// uses — NO application code needs a dev bypass, nothing in web/ changes.
// Grants no authority the holder of AUTH_SECRET doesn't already have: GM
// access is NOT faked, isGm() still asks Discord for real roles.
//
//   node scripts/dev/session.mjs --gm
//   node scripts/dev/session.mjs --character "Jorren"
//   node scripts/dev/session.mjs 262426987979735040

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encode, decode } from "@auth/core/jwt";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Must equal the cookie name — Auth.js derives the encryption key from
// (secret, salt), so a mismatch silently rejects the token. Unprefixed since
// plain http://localhost never gets the `__Secure-` prefix.
export const COOKIE_NAME = "authjs.session-token";

const DEFAULT_MAX_AGE = 24 * 60 * 60;

function readEnvFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function loadEnv() { // web/.env.local is what `next dev` loads; .env is the bot/Prisma fallback
  return {
    ...readEnvFile(resolve(REPO_ROOT, ".env")),
    ...readEnvFile(resolve(REPO_ROOT, "web/.env.local")),
  };
}

function authSecret(env) {
  const secret = env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET not found in web/.env.local or .env. The dev server cannot " +
        "have a valid session without it either, so check those files first.",
    );
  }
  return secret;
}

// Reads the canonical list out of db/lib/roleIds.js rather than copying it.
function superadminIds() {
  const path = resolve(REPO_ROOT, "db/lib/roleIds.js");
  const require = createRequire(import.meta.url);
  const ids = require(path).SUPERADMIN_DISCORD_IDS;
  if (!ids?.length) {
    throw new Error(`No Discord IDs found in ${path} — has its shape changed?`);
  }
  return ids;
}

async function characterDiscordId(query, env) {
  if (!process.env.DATABASE_URL && env.DATABASE_URL) { // db/index.js needs it before constructing the singleton
    process.env.DATABASE_URL = env.DATABASE_URL;
  }
  const require = createRequire(import.meta.url);
  const { prisma } = require("@lifeweb/db");

  const matches = await prisma.character.findMany({
    where: { status: "ALIVE", name: { contains: query, mode: "insensitive" } },
    select: { name: true, discordUserId: true },
    orderBy: { name: "asc" },
    take: 10,
  });
  await prisma.$disconnect();

  if (!matches.length) throw new Error(`No ALIVE character matching "${query}".`);
  if (matches.length > 1) {
    const names = matches.map((c) => `  ${c.name}`).join("\n");
    throw new Error(`"${query}" matches ${matches.length} characters:\n${names}`);
  }
  return { discordUserId: matches[0].discordUserId, label: matches[0].name };
}

export async function resolveTarget(argv, env = loadEnv()) {
  const gmIndex = argv.indexOf("--gm");
  if (gmIndex !== -1) {
    // DEV_SUPERADMIN_ID picks a different superadmin than the default first
    // one (which may not belong to this environment's guild); it must still
    // be on the superadmin.js list, so this stays a selector, never a door.
    const ids = superadminIds();
    const wanted = process.env.DEV_SUPERADMIN_ID;
    if (wanted && !ids.includes(wanted)) {
      throw new Error(`DEV_SUPERADMIN_ID ${wanted} is not in web/lib/superadmin.js`);
    }
    const id = wanted || ids[0];
    return { discordUserId: id, label: `superadmin ${id}` };
  }

  const charIndex = argv.indexOf("--character");
  if (charIndex !== -1) {
    const query = argv[charIndex + 1];
    if (!query || query.startsWith("--")) {
      throw new Error('--character needs a name, e.g. --character "Jorren"');
    }
    return characterDiscordId(query, env);
  }

  const snowflake = argv.find((a) => /^\d{17,20}$/.test(a));
  if (snowflake) return { discordUserId: snowflake, label: `discord user ${snowflake}` };

  throw new Error(
    "Specify who to sign in as: --gm, --character \"<name>\", or a raw Discord user ID.",
  );
}

export async function mintCookie(discordUserId, { maxAge = DEFAULT_MAX_AGE, env = loadEnv() } = {}) {
  const secret = authSecret(env);
  const now = Math.floor(Date.now() / 1000);

  // Mirrors web/lib/auth.js's jwt/session callbacks. `discordUserId` is the
  // only custom field the app consults; `sub` is Auth.js's own convention.
  const token = {
    discordUserId,
    sub: discordUserId,
    iat: now,
    exp: now + maxAge,
    jti: crypto.randomUUID(),
  };

  const jwt = await encode({ token, secret, salt: COOKIE_NAME, maxAge });

  const roundTrip = await decode({ token: jwt, secret, salt: COOKIE_NAME }); // fail here, not as a mystery redirect later
  if (roundTrip?.discordUserId !== discordUserId) {
    throw new Error("Minted token failed to decode — AUTH_SECRET or salt is wrong.");
  }

  return `${COOKIE_NAME}=${jwt}`;
}

async function main() {
  const env = loadEnv();
  const { discordUserId } = await resolveTarget(process.argv.slice(2), env);
  process.stdout.write(await mintCookie(discordUserId, { env }) + "\n"); // stdout carries only the cookie
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
