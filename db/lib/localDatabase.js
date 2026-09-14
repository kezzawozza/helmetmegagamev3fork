// Which database is this, and may this command touch it.
//
// WHY THIS EXISTS. On 2026-09-09 a throwaway regression harness ran
//
//   TRUNCATE TABLE "CharacterTag","Character","Turn","DirectMessage",
//                  "ArchiveEntry","AuditLog","StagedMessage" ... CASCADE
//
// against the LIVE database and emptied the game. The harness had a .env
// beside it naming a local Postgres, and it still went to Railway:
//
//   DATABASE_URL WAS ALREADY EXPORTED IN THE SHELL, AND dotenv.config() DOES
//   NOT OVERRIDE A VARIABLE THAT IS ALREADY SET.
//
// That is the whole mechanism, and it is silent — every script "pointed at
// local" was reading production and saying nothing about it. Writing a .env is
// not evidence of anything; only process.env.DATABASE_URL is. Nothing else
// stopped it either: .claude/hooks/db-guard.py matches a fixed list of known
// scripts, and `node some-scratch-file.js` is on no list.
//
// So the check moved to where it cannot be skipped: the shared client itself
// (db/index.js), plus this module for anything that wants to assert loudly up
// front. A guard that has to be remembered is a guard that will be forgotten
// at 4am by whoever is closest to the mistake.
//
// Stays OFF the @lifeweb/db barrel — the db/lib/dm.js convention — because the
// scripts that need it most are the ad-hoc ones, and they should require it by
// path without dragging the whole barrel (and a live client) in behind it.

// Anything that is not one of these three is treated as somebody's real data.
// Deliberately an allowlist: a new hostname is guilty until named.
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/;

// The verbs that cannot be undone and that no application code in this repo
// uses. Every TRUNCATE and DROP in the tree lives in db/prisma/migrations/*.sql,
// which the Prisma CLI applies without going through the shared client — so
// refusing them here costs nothing real. The legitimate raw SQL is pg_notify,
// one UPDATE in db/lib/tagWrites.js, a SELECT in db/lib/depotState.js and the
// LocationLink reset in the wipe; none of it matches.
const IRREVERSIBLE = /\b(TRUNCATE|DROP\s+(TABLE|SCHEMA|DATABASE|VIEW|INDEX))\b/i;

function databaseHost(url = process.env.DATABASE_URL) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isLocalDatabase(url = process.env.DATABASE_URL) {
  const host = databaseHost(url);
  return host != null && LOCAL_HOSTS.test(host);
}

// For a script that writes throwaway data: call it FIRST, before anything
// opens a connection. Throws rather than returning a boolean, because a
// boolean is something a caller can forget to check.
function requireLocalDatabase(what = "This script") {
  const url = process.env.DATABASE_URL;
  const host = databaseHost(url);
  if (host == null) {
    throw new Error(
      `${what} needs DATABASE_URL to be a parseable URL; it is ${url ? `"${url}"` : "unset"}.`,
    );
  }
  if (!LOCAL_HOSTS.test(host)) {
    throw new Error(
      `${what} writes throwaway data and DATABASE_URL's host is "${host}", not localhost. ` +
        "Point it at a local Postgres first (npm run dev:setup, docs/systemdocs/LOCAL-DEV.md). " +
        "Check `echo $DATABASE_URL`, not the .env file: an exported variable wins, and " +
        "dotenv.config() will not override it.",
    );
  }
}

// The text of a raw query, whichever of the four shapes Prisma was handed:
// a tagged template (TemplateStringsArray), a Prisma.sql object, or a plain
// string from the *Unsafe variants.
function rawSqlText(args) {
  const first = Array.isArray(args) ? args[0] : args;
  if (typeof first === "string") return first;
  if (first && Array.isArray(first.strings)) return first.strings.join(" ");
  if (Array.isArray(first)) return first.join(" ");
  if (first && typeof first.sql === "string") return first.sql;
  return "";
}

// The one the shared client calls on every raw query. Throws — never returns
// false — so a caller cannot proceed by ignoring it. NO BYPASS, deliberately:
// there is no env var and no CONFIRMED=1 for this one, because nothing in this
// codebase has a legitimate reason to truncate or drop a live table. For a
// genuine emergency there is psql, which is a decision somebody makes with
// their hands rather than one a script makes on their behalf.
function assertRawSqlAllowed(args, url = process.env.DATABASE_URL) {
  if (isLocalDatabase(url)) return;
  const sql = rawSqlText(args);
  if (!IRREVERSIBLE.test(sql)) return;
  const verb = sql.match(IRREVERSIBLE)[0].replace(/\s+/g, " ").toUpperCase();
  throw new Error(
    `Refused: ${verb} through the shared Prisma client against "${databaseHost(url) ?? "an unknown host"}", ` +
      "which is not a local database. This is somebody's real game. " +
      "See db/lib/localDatabase.js — there is no bypass; use psql if you truly mean it.",
  );
}

module.exports = {
  isLocalDatabase,
  requireLocalDatabase,
  assertRawSqlAllowed,
  rawSqlText,
};
