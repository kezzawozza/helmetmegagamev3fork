// Load real pages against the local dev server, signed in, and report what
// happened. Companion to session.mjs. Exists because the failure this repo
// has actually shipped is a page that builds clean and lints clean and
// throws only when someone opens it (CLAUDE.md's `no-undef` note).
//
//   npm run dev:check                             # the whole matrix below
//   npm run dev:check -- --gm /gm/turns           # named routes, as a superadmin
//   npm run dev:check -- --character "Aezir" /faction
//   npm run dev:check -- --anon /character        # no cookie
//
// Exits non-zero if anything fails, so it can gate a change.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mintCookie, resolveTarget } from "./session.mjs";

const BASE = process.env.DEV_CHECK_BASE ?? "http://localhost:3000";

// Routes, who should be looking at them, and where a redirect is the CORRECT
// answer (`expect`; its absence means "must render"). The negative cases at
// the bottom matter as much as the positive ones: they fail if a gate loosens.
const DEFAULT_ROUTES = [
  { path: "/handbook", as: "public" }, // the one public route; doubles as "is the server up"

  { path: "/character", as: "player" },
  { path: "/chat", as: "player" },
  { path: "/map", as: "player" },
  { path: "/documents", as: "player" },
  { path: "/faction", as: "player" },
  { path: "/notes", as: "player" },

  { path: "/store", as: "player", expect: "/character" }, // deliberate redirect stub for old links
  { path: "/depot", as: "player", expect: "/character" }, // gated on a licence, not on being a player
  { path: "/gm", as: "gm", expect: "/gm/players" },

  { path: "/archive", as: "gm" }, // conditional on game state; checked as GM to keep the run stable
  { path: "/lifeweb", as: "gm" },

  { path: "/gm/players", as: "gm" },
  { path: "/gm/turns", as: "gm" },
  { path: "/gm/audit", as: "gm" },
  { path: "/gm/structures", as: "gm" },
  { path: "/gm/dev?s=gamemasters", as: "gm" },
  { path: "/gm/dev", as: "gm" },
  // Sections of the panel now, not pages. The old paths redirect, and that
  // redirect is worth asserting: they are what /gm/audit's rows and a year of
  // bookmarks point at.
  { path: "/gm/dev?s=characters", as: "gm" },
  { path: "/gm/dev?s=factions", as: "gm" },
  { path: "/gm/dev?s=tags", as: "gm" },
  { path: "/gm/dev?s=zones", as: "gm" },
  { path: "/gm/dev?s=bulk", as: "gm" },
  { path: "/gm/dev/characters", as: "gm", expect: "/gm/dev?s=characters" },
  { path: "/gm/dev/factions", as: "gm", expect: "/gm/dev?s=factions" },
  { path: "/gm/dev/tags", as: "gm", expect: "/gm/dev?s=tags" },
  { path: "/gm/dev/zones", as: "gm", expect: "/gm/dev?s=zones" },
  { path: "/ledger", as: "gm", expect: "/character" }, // old sheet path forward (SHEET.md)
  { path: "/ledger", as: "player", expect: "/character" },

  { path: "/character", as: "anon", expect: "/" },
  { path: "/chat", as: "anon", expect: "/" },
  { path: "/map", as: "anon", expect: "/" },
  { path: "/gm/turns", as: "anon", expect: "/" },
  { path: "/gm/turns", as: "player", expect: "/character" },
  { path: "/gm/players", as: "player", expect: "/character" },
  { path: "/gm/dev", as: "player", expect: "/character" },
  { path: "/gm/structures", as: "player", expect: "/character" },
  { path: "/gm/structures", as: "anon", expect: "/" },
  { path: "/gm/dev?s=gamemasters", as: "player", expect: "/character" }, // GM roster now lives here
  { path: "/ledger", as: "anon", expect: "/" },
];

// A server component that throws still answers 200: React streams the shell,
// then encodes the error as a flight row in the RSC payload. Production
// strips the name/message, leaving only the digest — which is why the
// digest, not the message, is what's matched.
const FLIGHT_ERROR = /[0-9a-f]+:E\{\\?"digest\\?":\\?"([^"\\]+)/;
const ERROR_NAME = /\\?"name\\?":\\?"([A-Za-z]*Error)\\?",\\?"message\\?":\\?"((?:[^"\\]|\\.){0,400})/;

function bodyError(html) {
  const flight = html.match(FLIGHT_ERROR);
  if (!flight) return null;
  const detail = html.match(ERROR_NAME);
  if (!detail) return `server error, digest ${flight[1]}`;

  const message = detail[2]
    .replace(/__TURBOPACK__[A-Za-z0-9_$]*\[\\*"([^"\\]+)\\*"\]/g, "$1") // Turbopack's mangled module accessor
    .replace(/\\+n/g, " ") // collapse escaped newlines to one row per route
    .replace(/\\+(.)/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/ invocation in .*$/, "") // trim Prisma's source-excerpt tail
    .trim()
    .slice(0, 110);

  return message ? `${detail[1]}: ${message}` : detail[1];
}

// A redirect() called from a *page* rather than a layout usually lands after
// streaming has begun, so the status line is already committed to 200 and
// the real instruction rides along in the RSC payload instead — the body is
// the authority, not the status.
function streamedRedirect(html) {
  const match = html.match(/NEXT_REDIRECT[;,]([a-z]+)[;,]([^;,"\\]+)/);
  return match ? match[2] : null;
}

async function probe(path, cookie) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(BASE + path, { // manual redirect so an auth bounce stays visible
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });
  } catch (err) {
    return { ms: Date.now() - started, note: `unreachable — ${err.message}` };
  }

  const ms = Date.now() - started;
  const status = res.status;

  if (status >= 300 && status < 400) {
    return { ms, status, redirect: res.headers.get("location") };
  }
  if (status >= 400) return { ms, status, note: "error status" };

  const html = await res.text();

  const streamed = streamedRedirect(html);
  if (streamed) return { ms, status, redirect: streamed, streamed: true };

  const marker = bodyError(html);
  if (marker) return { ms, status, note: `rendered an error (${marker})` };

  return { ms, status, rendered: true };
}

function redirectMatches(actual, expected) { // ignores query string
  return actual && actual.split("?")[0] === expected.split("?")[0];
}

function judge(result, expect) {
  if (result.note) return { ok: false, note: result.note };

  if (expect) {
    if (!result.redirect) return { ok: false, note: `expected redirect -> ${expect}, but it rendered` };
    return redirectMatches(result.redirect, expect)
      ? { ok: true, note: `-> ${result.redirect}` }
      : { ok: false, note: `expected -> ${expect}, got -> ${result.redirect}` };
  }

  if (result.redirect) {
    return { ok: false, note: `${result.streamed ? "streamed " : ""}redirect -> ${result.redirect}` };
  }
  return { ok: true, note: "" };
}

async function defaultPlayer() { // any ALIVE character; first alphabetically for a stable, reproducible run
  const require = createRequire(import.meta.url);
  const { prisma } = require("@lifeweb/db");
  const character = await prisma.character.findFirst({
    where: { status: "ALIVE" },
    select: { name: true, discordUserId: true },
    orderBy: { name: "asc" },
  });
  await prisma.$disconnect();
  if (!character) throw new Error("No ALIVE character in the database to check player routes with.");
  return character;
}

async function runMatrix() {
  const gm = await resolveTarget(["--gm"]);
  const player = await defaultPlayer();

  const cookies = {
    public: null,
    anon: null,
    gm: await mintCookie(gm.discordUserId),
    player: await mintCookie(player.discordUserId),
  };

  console.log(`${BASE}`);
  console.log(`  gm      ${gm.label}`);
  console.log(`  player  ${player.name}\n`);

  const failures = [];
  for (const route of DEFAULT_ROUTES) {
    const result = await probe(route.path, cookies[route.as]);
    const verdict = judge(result, route.expect);
    if (!verdict.ok) failures.push(route);
    console.log(
      `${verdict.ok ? "ok  " : "FAIL"} ${String(result.status ?? "---").padEnd(3)} ` +
        `${route.as.padEnd(6)} ${route.path.padEnd(22)} ${String(result.ms).padStart(5)}ms` +
        (verdict.note ? `  ${verdict.note}` : ""),
    );
  }

  console.log(`\n${DEFAULT_ROUTES.length - failures.length}/${DEFAULT_ROUTES.length} ok`);
  return failures.length === 0;
}

async function runRoutes(argv, routes) {
  const anon = argv.includes("--anon");
  let cookie = null;
  let who = "anonymous";
  if (!anon) {
    const target = await resolveTarget(argv.filter((a) => !a.startsWith("/"))); // strip route paths
    cookie = await mintCookie(target.discordUserId);
    who = target.label;
  }

  console.log(`${BASE} as ${who} — ${routes.length} route${routes.length === 1 ? "" : "s"}\n`);

  let failures = 0;
  for (const path of routes) { // serial: `next dev` compiles on demand; parallel starves it
    const result = await probe(path, cookie);
    const verdict = judge(result, null);
    if (!verdict.ok) failures++;
    console.log(
      `${verdict.ok ? "ok  " : "FAIL"} ${String(result.status ?? "---").padEnd(3)} ` +
        `${path.padEnd(22)} ${String(result.ms).padStart(5)}ms` +
        (verdict.note ? `  ${verdict.note}` : ""),
    );
  }

  console.log(`\n${routes.length - failures}/${routes.length} ok`);
  return failures === 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const routes = argv.filter((a) => a.startsWith("/"));
  const ok = routes.length ? await runRoutes(argv, routes) : await runMatrix();
  if (!ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
