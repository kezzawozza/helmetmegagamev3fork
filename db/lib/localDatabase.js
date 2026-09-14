// Which database is this, and may this command touch it. WHY THIS EXISTS: `dotenv.config()` does NOT
// override a variable already exported in the shell, so a script with a local `.env` beside it can
// still silently write to Railway — writing a .env is not evidence of anything, only
// process.env.DATABASE_URL is. `.claude/hooks/db-guard.py` only matches a fixed list of known scripts,
// so the check also moved to where it cannot be skipped: the shared client itself (db/index.js), plus
// this module for anything that wants to assert loudly up front.
// Stays OFF the @lifeweb/db barrel (db/lib/dm.js convention) so ad-hoc scripts require it by path
// without dragging a live client in behind it.

// Anything not one of these three is treated as somebody's real data. Deliberately an allowlist.
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/;

// The verbs that cannot be undone and that no application code in this repo uses — every TRUNCATE/DROP
// in the tree lives in db/prisma/migrations/*.sql, applied by the Prisma CLI, not the shared client.
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

// For a script that writes throwaway data: call it FIRST, before anything opens a connection. Throws
// rather than returning a boolean — a boolean is something a caller can forget to check.
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

// The text of a raw query, whichever shape Prisma was handed: a tagged template, a Prisma.sql object,
// or a plain string from the *Unsafe variants.
function rawSqlText(args) {
  const first = Array.isArray(args) ? args[0] : args;
  if (typeof first === "string") return first;
  if (first && Array.isArray(first.strings)) return first.strings.join(" ");
  if (Array.isArray(first)) return first.join(" ");
  if (first && typeof first.sql === "string") return first.sql;
  return "";
}

// The one the shared client calls on every raw query. Throws — never returns false. NO BYPASS,
// deliberately: nothing in this codebase has a legitimate reason to truncate or drop a live table. For
// a genuine emergency there is psql, a decision somebody makes with their hands, not a script's own.
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
