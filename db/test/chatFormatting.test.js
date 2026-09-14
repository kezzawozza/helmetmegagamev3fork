// The guard on chat's own two marks — quoted speech and ||spoilers|| — and on
// the escape that keeps a {kind:payload} token in one piece. `remark-parse`
// builds the whole inline tree before any plugin runs, cutting a paragraph
// into siblings around any `*star*`/`` `tick` ``/`~~tilde~~`/`[link](…)`; the
// old mdast-util-find-and-replace passes saw one text node at a time, so
// emphasis broke most quotes and spoilers. The trees below are the shapes
// remark ACTUALLY produces off a real run, not invented — if remark changes
// what it hands over, re-check against a live parse. Loaded with `import()`
// since these are ESM files in another workspace.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const COMPONENTS = path.join(__dirname, "..", "..", "web", "app", "components");
const load = (file) => import(pathToFileURL(path.join(COMPONENTS, file)).href);

const text = (value) => ({ type: "text", value });
const emphasis = (value) => ({ type: "emphasis", children: [text(value)] });
const paragraph = (...children) => ({ type: "root", children: [{ type: "paragraph", children }] });

// The shape of a transformed tree, as one readable string:
//   he said span.speech["get out"]
function shape(node) {
  if (node.type === "text") return JSON.stringify(node.value);
  if (node.type === "inlineCode") return `code(${JSON.stringify(node.value)})`;
  const name = node.data?.hName ?? node.type;
  const className = node.data?.hProperties?.className;
  const kids = (node.children ?? []).map(shape).join(" ");
  return `${className ? `${name}.${className}` : name}[${kids}]`;
}

async function run(tree) {
  const { default: remarkChat } = await load("remarkChat.js");
  remarkChat()(tree);
  return shape(tree.children[0]);
}

test("a quote keeps the formatting inside it", async () => {
  // `he said "*get out*" and left`
  const tree = paragraph(text('he said "'), emphasis("get out"), text('" and left'));
  assert.equal(
    await run(tree),
    'paragraph["he said " span.speech["\\"" emphasis["get out"] "\\""] " and left"]',
  );
});

test("a spoiler keeps the formatting inside it, and drops its bars", async () => {
  // `||the *password* is rosebud||`
  const tree = paragraph(text("||the "), emphasis("password"), text(" is rosebud||"));
  assert.equal(
    await run(tree),
    'paragraph[chatspoiler.chat-spoiler["the " emphasis["password"] " is rosebud"]]',
  );
});

test("plain text still matches, and a curly pair counts", async () => {
  assert.equal(
    await run(paragraph(text('he said "get out" and left'))),
    'paragraph["he said " span.speech["\\"get out\\""] " and left"]',
  );
  assert.equal(await run(paragraph(text("“hush”"))), 'paragraph[span.speech["“hush”"]]');
  assert.equal(await run(paragraph(text("||secret||"))), 'paragraph[chatspoiler.chat-spoiler["secret"]]');
});

test("a run that should not match, does not", async () => {
  assert.equal(
    await run(paragraph(text('he said " nothing here'))),
    'paragraph["he said \\"" " nothing here"]',
  );
  assert.equal(
    await run(paragraph(text('an unclosed " quote'))),
    'paragraph["an unclosed \\"" " quote"]',
  );
  assert.equal(await run(paragraph(text('"" empty'))), 'paragraph["\\"" "\\"" " empty"]');
  assert.equal(await run(paragraph(text('"two\nlines"'))), 'paragraph["\\"" "two\\nlines\\""]');
  const long = "x".repeat(420); // past the 400-character cap, a quote gives up rather than reaching further
  assert.equal(
    await run(paragraph(text(`"${long}"`))),
    `paragraph["\\"" ${JSON.stringify(`${long}"`)}]`,
  );
});

test("code is left alone, on both passes", async () => {
  const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "inlineCode", value: '"not a quote" ||not hidden||' }] }] };
  assert.equal(await run(tree), 'paragraph[code("\\"not a quote\\" ||not hidden||")]');
});

test("a quote wraps a resolved token whole, and nests with a spoiler", async () => {
  const token = { type: "richToken", data: { hName: "richtoken", hProperties: { kind: "char", payload: "cmtt1|Ada" } }, children: [] };
  assert.equal(
    await run(paragraph(text('"a quote with a '), token, text(' in it"'))),
    'paragraph[span.speech["\\"a quote with a " richtoken[] " in it\\""]]',
  );

  assert.equal(
    await run(paragraph(text('||a spoiler with a "quote" in it||'))),
    'paragraph[chatspoiler.chat-spoiler["a spoiler with a " span.speech["\\"quote\\""] " in it"]]',
  );
});

test("a quote written inside emphasis is found there", async () => {
  const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "emphasis", children: [text('she said "no"')] }] }] };
  assert.equal(await run(tree), 'paragraph[emphasis["she said " span.speech["\\"no\\""]]]');
});

test("a token's payload is escaped, not parsed", async () => {
  const { default: escape } = await load("tokenEscape.js");

  assert.equal(escape("{char:cmtt1|Bob *the Blade* Marley}"), "{char:cmtt1\\|Bob \\*the Blade\\* Marley}");
  assert.equal(escape("{tag:foo|My _Custom_ Tag}"), "{tag:foo\\|My \\_Custom\\_ Tag}");
  assert.equal(escape("{info:costs `5` gold}"), "{info:costs \\`5\\` gold}");

  const once = escape("{char:cmtt1|Bob *the Blade* Marley}"); // idempotent
  assert.equal(escape(once), once);

  assert.equal(escape("no tokens *here*"), "no tokens *here*");
  assert.equal(escape("a {not a token} b"), "a {not a token} b");

  assert.equal(escape("`{char:cmtt1|Ada}` shown as syntax"), "`{char:cmtt1|Ada}` shown as syntax"); // bar stays bare
});
