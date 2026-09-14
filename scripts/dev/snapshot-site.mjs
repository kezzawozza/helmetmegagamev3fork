// Freeze every page of the signed-in app into flat, self-contained HTML files
// that need no session to view — every URL here redirects to a Discord
// login, so instead of opening the door this takes a photocopy. Each route
// is opened in a real browser holding a minted dev cookie
// (scripts/dev/session.mjs), left alone until it stops fetching, and only
// then serialized. A plain fetch is NOT enough: most of this app paints
// after hydration, so a fetch before that is a photocopy of a spinner.
//
// Drives the Chrome already on the machine through puppeteer-core (a driver,
// not a browser; downloads nothing), deliberately not a workspace dependency
// — install it anywhere and point PUPPETEER_DIR at that folder.
//
// Output is static and unauthenticated once written, so give it an
// unguessable directory name — real player data is in these files.
//
//   npm run dev:web                        # must already be running
//   node scripts/dev/snapshot-site.mjs     # -> web/public/ux/<random>/
//   node scripts/dev/snapshot-site.mjs --character "Knife" --dir ux/mine
//
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { mintCookie, resolveTarget } from "./session.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.DEV_CHECK_BASE ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const require = createRequire(import.meta.url);

function loadPuppeteer() {
  const dir = process.env.PUPPETEER_DIR;
  const from = dir ? createRequire(resolve(dir, "noop.js")) : require;
  try {
    return from("puppeteer-core");
  } catch {
    throw new Error(
      "puppeteer-core not found. Install it somewhere (npm i puppeteer-core) " +
        "and set PUPPETEER_DIR to that folder. It drives the Chrome already on " +
        "this machine, so nothing is downloaded.",
    );
  }
}

// Who should be looking at each page (mirrors check.mjs, minus negative cases).
const ROUTES = [
  ["/handbook", "public"],
  ["/character", "player"],
  ["/chat", "player"],
  ["/documents", "player"],
  ["/faction", "player"],
  ["/notes", "player"],
  ["/archive", "gm"],
  ["/lifeweb", "gm"],
  ["/depot", "gm"],
  ["/gm/players", "gm"],
  ["/gm/turns", "gm"],
  ["/gm/audit", "gm"],
  ["/gm/structures", "gm"],
  ["/gm/crafts", "gm"],
  ["/gm/dev", "gm"],
  ["/gm/dev?s=gamemasters", "gm"],
  ["/gm/dev/characters", "gm"],
  ["/gm/dev/factions", "gm"],
  ["/gm/dev/tags", "gm"],
];

// A detail page's URL carries an id only the data knows; pull one out of the
// already-loaded index page.
const DERIVED = [
  { from: "/gm/players", pattern: /\/gm\/players\/(\d{17,20})/, as: "gm" },
  { from: "/gm/dev/characters", pattern: /\/gm\/dev\/characters\/([a-z0-9]{20,32})/, as: "gm" },
];

function slugFor(route) {
  const s = route.replace(/^\//, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (s || "index") + ".html";
}

// Default is the character carrying the most tags — the fullest version of
// each screen, so a half-made test character doesn't snapshot nothing.
async function pickPlayer(name) {
  const { prisma } = require("@lifeweb/db");
  const all = await prisma.character.findMany({
    where: { status: "ALIVE", ...(name ? { name: { contains: name, mode: "insensitive" } } : {}) },
    select: { name: true, discordUserId: true, _count: { select: { tags: true } } },
  });
  await prisma.$disconnect();
  if (!all.length) throw new Error(`No ALIVE character${name ? ` matching "${name}"` : ""}.`);
  all.sort((a, b) => b._count.tags - a._count.tags);
  return all[0];
}

// Runs inside the page — only place the hydrated DOM and parsed stylesheets are reachable.
function serialize() {
  const css = [...document.styleSheets] // same-origin; rules read straight out
    .map((sheet) => {
      try {
        return [...sheet.cssRules].map((r) => r.cssText).join("\n");
      } catch {
        return "";
      }
    })
    .join("\n");

  const doc = document.documentElement.cloneNode(true);
  for (const el of doc.querySelectorAll("script, link[rel='stylesheet'], link[rel='preload'], style")) {
    el.remove();
  }
  const style = document.createElement("style");
  style.textContent = css;
  doc.querySelector("head")?.appendChild(style);

  return "<!doctype html>\n" + doc.outerHTML;
}

async function capture(browser, route, cookie) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  if (cookie) {
    const [name, ...rest] = cookie.split("=");
    await browser.setCookie({ name, value: rest.join("="), domain: "localhost", path: "/" });
  }
  try {
    const res = await page.goto(BASE + route, { waitUntil: "networkidle0", timeout: 60000 });
    const landed = new URL(page.url()).pathname;
    const wanted = new URL(route, BASE).pathname;
    if (landed !== wanted) return { error: `redirected -> ${landed}` }; // a gate redirects rather than erroring
    if (res && res.status() >= 400) return { error: `HTTP ${res.status()}` };
    await new Promise((r) => setTimeout(r, 1200)); // networkidle0 says fetches stopped, not that render landed
    const html = await page.evaluate(serialize);
    return { html };
  } catch (err) {
    return { error: err.message.split("\n")[0] };
  } finally {
    await page.close();
  }
}

// Pulls down each asset reference once and rewrites it, so the folder opens
// with no server behind it at all.
async function localizeAssets(html, cookie, assets) {
  let out = html;
  const refs = new Set();
  for (const m of out.matchAll(/(?:src|href)="(\/(?!\/)[^"]*)"/g)) refs.add(m[1]);
  for (const m of out.matchAll(/url\(\s*["']?(\/(?!\/)[^"')]+)["']?\s*\)/g)) refs.add(m[1]);

  for (const ref of refs) {
    if (!/^\/(_next|api\/avatar|assets|favicon|icon|apple)/.test(ref)) continue;
    let local = assets.get(ref);
    if (!local) {
      try {
        const res = await fetch(new URL(ref, BASE), { headers: cookie ? { Cookie: cookie } : {} });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = (ref.match(/\.([a-z0-9]{2,5})(?:\?|$)/i)?.[1] ?? "bin").toLowerCase();
        local = `a/${randomBytes(6).toString("hex")}.${ext}`;
        assets.set(ref, local);
        assets.set("data:" + local, buf);
      } catch {
        continue;
      }
    }
    out = out.split(`"${ref}"`).join(`"${local}"`).split(`(${ref})`).join(`(${local})`);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const dirArg = argv.indexOf("--dir");
  const charArg = argv.indexOf("--character");
  const relDir = dirArg !== -1 ? argv[dirArg + 1] : `ux/${randomBytes(8).toString("hex")}`;
  const outDir = resolve(REPO_ROOT, "web/public", relDir);

  const puppeteer = loadPuppeteer();
  const player = await pickPlayer(charArg !== -1 ? argv[charArg + 1] : null);
  const cookies = {
    public: null,
    gm: await mintCookie((await resolveTarget(["--gm"])).discordUserId),
    player: await mintCookie(player.discordUserId),
  };
  console.log(`player pages as: ${player.name}`);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

  const routes = [...ROUTES];
  const raw = new Map();
  const failures = [];

  const run = async (route, as) => {
    const { html, error } = await capture(browser, route, cookies[as]);
    if (error) {
      failures.push([route, error]);
      console.log(`  x  ${route} (${as}) — ${error}`);
      return;
    }
    raw.set(route, html);
    console.log(`  ok ${route} (${as})`);
  };

  for (const [route, as] of routes) await run(route, as); // first pass; derived routes need this to already exist

  for (const { from, pattern, as } of DERIVED) {
    const id = raw.get(from)?.match(pattern)?.[1];
    if (!id) {
      console.log(`  .  no detail id found on ${from}`);
      continue;
    }
    const route = `${from}/${id}`;
    await run(route, as);
    if (raw.has(route)) routes.push([route, as]);
  }

  await browser.close();

  mkdirSync(resolve(outDir, "a"), { recursive: true });

  const assets = new Map();
  const pages = [];
  for (const [route, as] of routes) {
    const html = raw.get(route);
    if (!html) continue;
    let frozen = await localizeAssets(html, cookies[as], assets);
    for (const [other] of routes) { // point nav at the snapshots instead of live routes
      frozen = frozen.split(`href="${other}"`).join(`href="${slugFor(other)}"`);
    }
    frozen = frozen.replace(/href="\/(?![a-z0-9]*\.)[^"]*"/g, 'href="index.html"');
    writeFileSync(resolve(outDir, slugFor(route)), frozen);
    pages.push([route, as]);
  }

  for (const [key, val] of assets) {
    if (key.startsWith("data:")) writeFileSync(resolve(outDir, key.slice(5)), val);
  }

  const rows = pages
    .map(([route, as]) => `<li><a href="${slugFor(route)}">${route}</a> <span>${as}</span></li>`)
    .join("\n");
  writeFileSync(
    resolve(outDir, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Bascinet screens</title>
<meta name="robots" content="noindex,nofollow">
<base href="/${relDir}/">
<style>body{font:15px/1.6 system-ui;margin:3rem auto;max-width:40rem;padding:0 1rem}
h1{font-size:1.3rem}li{margin:.2rem 0}span{opacity:.5;font-size:.8em}</style>
<h1>Bascinet screens</h1>
<p>Frozen copies of every page, captured ${new Date().toISOString().slice(0, 10)}.</p>
<ul>
${rows}
</ul>`,
  );

  const assetCount = [...assets.keys()].filter((k) => !k.startsWith("data:")).length;
  console.log(`\n${pages.length} pages, ${assetCount} assets -> web/public/${relDir}/`);
  for (const [route, error] of failures) console.log(`  skipped ${route}: ${error}`);
  console.log(`\nhttps://ravenheart.quest/${relDir}/index.html`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
