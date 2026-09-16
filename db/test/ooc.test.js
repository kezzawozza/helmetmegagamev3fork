// The two spellings of an OOC line, and why they are two (db/lib/ooc.js).
//
// This exists because the one-spelling version SHIPPED BROKEN: `[OOC]: hi` at
// the start of a block is a Markdown link reference definition, which renders
// as nothing, so the line was invisible on /play while showing correctly on
// Discord. It bit precisely the messages people send — a single word is a
// valid link destination — and survived review because the example anybody
// tries by hand ("hello there") has a space in it, which is an INVALID
// destination and falls back to a paragraph.
const test = require("node:test");
const assert = require("node:assert/strict");
const { oocBody, oocRowBody, oocLine } = require("../lib/ooc");

// The shape of a link reference definition, which is what must never survive
// into a row: an unescaped `[label]:` opening a block.
const LOOKS_LIKE_A_DEFINITION = /^\[[^\]]*\]:/;

// The messages that actually broke: one word, so one valid link destination.
const SHORT = ["hi", "brb", "yes?", "http://example.com", "ok"];

test("Discord keeps the plain brackets, and the presented name is inside them", () => {
  assert.equal(oocBody("hi", "Alice"), "[OOC (Alice): hi]");
  assert.equal(oocLine("hi", "Alice"), "-# [OOC (Alice): hi]");
  // No backslashes on this side, or Discord prints them.
  assert.ok(!oocLine("hi", "Alice").includes("\\"));
});

test("the archive row escapes the outer brackets, so it is not a definition", () => {
  for (const m of SHORT) {
    const row = oocRowBody(m, "Alice");
    assert.ok(!LOOKS_LIKE_A_DEFINITION.test(row), `${row} still opens like a link definition`);
    assert.ok(row.startsWith("\\["), row);
    assert.ok(row.endsWith("\\]"), row);
    assert.ok(row.includes("(Alice): "), row);
  }
});

test("both spellings still read as the format the game promised", () => {
  // Escaped or not, what a player MEETS is `[OOC (Name): …]` — the backslashes
  // are markup, and the test is that nothing else crept in.
  for (const m of ["hi", "hello there"]) {
    assert.equal(oocRowBody(m, "Alice").replace(/\\/g, ""), oocBody(m, "Alice"));
    assert.equal(oocBody(m, "Alice"), `[OOC (Alice): ${m}]`);
  }
});

test("a multi-word line is not special-cased", () => {
  // The bug's worst property was that it depended on the message. Both
  // spellings must carry the raw message between the label and the closing
  // bracket, whatever the text.
  for (const m of ["hi", "hello there", "a|b", "**bold**", ""]) {
    assert.ok(oocBody(m, "Alice").endsWith(`${m}]`));
    assert.ok(oocRowBody(m, "Alice").endsWith(`${m}\\]`));
  }
});

test("a null name falls back to the un-named shape so a caller mistake never crashes", () => {
  // Every real path threads a name — this is a defensive shim.
  assert.equal(oocBody("hi", null), "[OOC]: hi");
  assert.equal(oocLine("hi", null), "-# [OOC]: hi");
  assert.equal(oocRowBody("hi", null), "\\[OOC\\]: hi");
  // Default arg — same shape.
  assert.equal(oocBody("hi"), "[OOC]: hi");
});

test("the presented name a hooded speaker wears sits in the label", () => {
  // The rule ooc() applies: forced > concealed > own. The tests can't reach
  // Prisma, so this only pins that oocBody trusts whatever name it is given —
  // the source of that name (loadPresentedState + presentedIdentity) is a
  // db/lib/say.js contract this module reuses verbatim.
  assert.equal(oocBody("hi", "A young man"), "[OOC (A young man): hi]");
  assert.equal(oocBody("hi", "Solomon Baker"), "[OOC (Solomon Baker): hi]");
});
