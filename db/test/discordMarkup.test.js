// The guard that keeps Discord's syntax readable on the web. Text that
// reaches DirectMessage.content is read on two faces — Discord renders
// `<t:…:F>`/`<@…>` natively, the web renders whatever
// web/app/components/remarkDiscord.js has been taught; when they disagree a
// player reads the literal tag. No allowlist: every source file under
// db/lib, bot/src, web/lib and web/app is scanned for markup NOBODY HAS
// TAUGHT THE RENDERER.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DISCORD_MARKUP,
  DISCORD_MARKUP_KINDS,
  TIMESTAMP_STYLES,
  DEFAULT_TIMESTAMP_STYLE,
  findDiscordMarkup,
  findUnknownMarkup,
} = require("../lib/discordMarkup");

const REPO = path.join(__dirname, "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "generated", "migrations"]);

function jsFilesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}


// Strips comments (documentation, not a leak) and replaces `${…}`
// interpolations with a stand-in snowflake, innermost-first since they nest.
function readable(source) {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  for (let pass = 0; pass < 10; pass += 1) {
    const next = out.replace(/\$\{[^{}]*\}/g, "1000000000");
    if (next === out) break;
    out = next;
  }
  return out;
}

// Every source file, not just callers of sendDm — chasing the call graph
// missed lobby.js, which builds a seat DM that lobbySweep.js sends.
function scannedSources() {
  const roots = ["db/lib", "bot/src", "web/lib", "web/app"].map((r) => path.join(REPO, r));
  return roots
    .flatMap(jsFilesUnder)
    .map((file) => ({ file, source: readable(fs.readFileSync(file, "utf8")) }));
}

test("the grammar knows all seven timestamp styles, and a bare tag defaults", () => {
  for (const style of TIMESTAMP_STYLES) {
    const [hit] = findDiscordMarkup(`at <t:1757700120:${style}>`);
    assert.equal(hit.kind, "timestamp");
    assert.deepEqual(hit.groups, ["1757700120", style]);
  }
  const [bare] = findDiscordMarkup("at <t:1757700120>");
  assert.deepEqual(bare.groups, ["1757700120", undefined]);
  assert.equal(DEFAULT_TIMESTAMP_STYLE, "f");
  assert.equal(findDiscordMarkup("<t:-86400:R>").length, 1); // pre-1970 is a legal timestamp
});

test("every mention spelling is classified, and none of them is prose", () => {
  const kinds = (s) => findDiscordMarkup(s).map((t) => t.kind);
  assert.deepEqual(kinds("<@123456789012345678>"), ["user"]);
  assert.deepEqual(kinds("<@!123456789012345678>"), ["user"]);
  assert.deepEqual(kinds("<@&123456789012345678>"), ["role"]);
  assert.deepEqual(kinds("<#123456789012345678>"), ["channel"]);
  assert.deepEqual(kinds("<:skull:123456789012345678>"), ["emoji"]);
  assert.deepEqual(kinds("<a:wave:123456789012345678>"), ["emoji"]);
  assert.deepEqual(kinds("@here and @everyone"), ["ping", "ping"]);
  for (const quiet of ["if a < b > c", "<3", "<html>", "</p>", "<https://x.test/a>", "an email <mailto:a@b.co>"]) {
    assert.deepEqual(findDiscordMarkup(quiet), [], quiet);
    assert.deepEqual(findUnknownMarkup(quiet), [], quiet);
  }
});

test("a syntax nobody has taught the renderer is caught, not ignored", () => {
  assert.deepEqual(findUnknownMarkup("<t:1757700120:F> <@123456789012345678>"), []);
  assert.deepEqual(
    findUnknownMarkup("a <sound:123456789012345678> here").map((u) => u.raw),
    ["<sound:123456789012345678>"],
  );
});

test("every Discord token in the source is one the renderer knows", () => {
  const sources = scannedSources();
  assert.ok(sources.length > 100, `only scanned ${sources.length} files — has the layout moved?`);

  const offences = [];
  for (const { file, source } of sources) {
    for (const bad of findUnknownMarkup(source)) {
      const line = source.slice(0, bad.index).split("\n").length;
      offences.push(`${path.relative(REPO, file)}:${line} — ${bad.raw}`);
    }
  }
  assert.deepEqual(
    offences,
    [],
    `Discord markup the web cannot render — and this text may well be stored and read on both faces:\n${offences.join("\n")}\n` +
      "Either teach db/lib/discordMarkup.js + remarkDiscord.js the token, or don't write it.",
  );
});

test("the renderer handles every kind the grammar defines", () => {
  // Read as text rather than imported: it's an ESM file in another workspace.
  const renderer = fs.readFileSync(path.join(REPO, "web/app/components/remarkDiscord.js"), "utf8");
  for (const kind of DISCORD_MARKUP_KINDS) {
    assert.ok(renderer.includes(`"${kind}"`), `remarkDiscord.js never mentions the ${kind} token (${DISCORD_MARKUP[kind].label})`);
  }
});

// The plugin-list assertions live in db/test/messageRenderers.test.js —
// one home for "the renderers agree" across all syntax passes.
