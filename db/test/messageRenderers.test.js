// The guard that keeps the message renderers agreeing about SYNTAX. The same
// words are read on several surfaces (/chat, a ⭐ under /notes, the transcript,
// a DM quote, the GM's audit peek), stored ONCE in one spelling — a mention is
// `{char:<id>}` (db/lib/characterMentions.js), a Discord timestamp is `<t:…>`,
// a subtext line is `-#`. A surface not taught one of those passes prints the
// plumbing at the reader instead of degrading gracefully. A surface does not
// get to know a different SYNTAX from its neighbours — what it decides is
// which tokens it RESOLVES, via the `components` map, not the plugin list.
// Read as text rather than imported: these are ESM files in another
// workspace, and readFileSync needs no build step.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..", "..");
const COMPONENTS = path.join(REPO, "web/app/components");

const read = (file) => fs.readFileSync(path.join(REPO, file), "utf8");

// Every `export const X_PLUGINS = [...]` in markdownPlugins.js, discovered
// rather than hardcoded, so a list added later is covered automatically.
function pluginLists() {
  const source = read("web/app/components/markdownPlugins.js");
  return source
    .split("\n")
    .filter((line) => /export const \w+_PLUGINS\s*=/.test(line))
    .map((line) => ({ name: line.match(/export const (\w+_PLUGINS)/)[1], line }));
}

test("every plugin list runs every syntax pass", () => {
  const lists = pluginLists();
  assert.ok(lists.length >= 2, "markdownPlugins.js exports no plugin lists — has the file moved?");

  for (const { name, line } of lists) {
    assert.ok(line.includes("remarkTokens"), `${name} dropped remarkTokens — a {char:…} will print as raw braces`);
    assert.ok(line.includes("remarkDiscord"), `${name} dropped remarkDiscord`);
    assert.ok(line.includes("remarkSubtext"), `${name} dropped remarkSubtext`);
    // Order is load-bearing (markdownPlugins.js says why): block-level must
    // run on raw text before any inline pass cuts the paragraph into children.
    assert.ok(line.indexOf("remarkSubtext") < line.indexOf("remarkDiscord"), `${name} runs remarkSubtext too late`);
    // Chat's own marks go LAST, after token and Discord passes (chatRuns.js:
    // remarkChat scans siblings, so a resolved mention stays inside a quote's wrap).
    if (line.includes("remarkChat")) {
      assert.ok(line.indexOf("remarkTokens") < line.indexOf("remarkChat"), `${name} runs remarkChat too early`);
      assert.ok(line.indexOf("remarkDiscord") < line.indexOf("remarkChat"), `${name} runs remarkChat too early`);
    }
  }
});

test("a renderer that runs remarkTokens also draws them", () => {
  // remarkTokens emits a <richtoken> node; a renderer that omits the component
  // renders NOTHING AT ALL, worse than the raw text.
  for (const file of fs.readdirSync(COMPONENTS)) {
    if (!file.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(COMPONENTS, file), "utf8");
    if (!/from "\.\/markdownPlugins"/.test(source)) continue; // matched by import, not by word
    assert.ok(source.includes("richtoken"), `${file} runs the token pass but renders no richtoken component`);
    assert.ok(source.includes("DISCORD_COMPONENTS"), `${file} renders no Discord nodes`);
  }
});

// Every surface that draws a body somebody WROTE. The two allowed renderers
// are ChatMarkdown (scene: speech tint, ||spoilers||) and MarkdownContent
// (prose). RichText is forbidden here: it's the FULL catalog resolver — a
// {tag:…} becomes a live hoverable chip, right for authored prose and wrong
// for anything a player typed, since it lets them mint one mid-scene.
const BODY_RENDERERS = [
  "web/app/(app)/chat/Feed.js",
  "web/app/(app)/notes/StarredList.js",
  "web/app/(app)/notes/JournalList.js",
  "web/app/(app)/notes/JournalComposer.js",
  "web/app/(app)/archive/ArchiveTranscript.js",
  "web/app/components/DmThread.js",
  "web/app/components/InspectorColumn.js",
  // The "in context" slice. The body lives in ArchiveContext.js; the modal is
  // only the frame around it now, and draws no body of its own — the OOC lens
  // on /gm/turns renders the same component in the middle of the desk.
  "web/app/components/ArchiveContext.js",
];

test("no message body is drawn raw, or by the full catalog resolver", () => {
  for (const file of BODY_RENDERERS) {
    const source = read(file);
    assert.ok(
      source.includes("ChatMarkdown") || source.includes("MarkdownContent"),
      `${file} draws a message body without a renderer — a raw string prints the tokens at the reader`,
    );
    assert.ok(
      !/^import RichText from/m.test(source),
      `${file} renders a player-written body through RichText, which resolves the whole catalog`,
    );
  }
});
