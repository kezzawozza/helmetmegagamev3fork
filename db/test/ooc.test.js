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

test("Discord keeps the plain brackets", () => {
  assert.equal(oocBody("hi"), "[OOC]: hi");
  assert.equal(oocLine("hi"), "-# [OOC]: hi");
  // No backslashes on this side, or Discord prints them.
  assert.ok(!oocLine("hi").includes("\\"));
});

test("the archive row escapes them, so it is not a definition", () => {
  for (const m of SHORT) {
    const row = oocRowBody(m);
    assert.ok(!LOOKS_LIKE_A_DEFINITION.test(row), `${row} still opens like a link definition`);
    assert.ok(row.startsWith("\\["), row);
  }
});

test("both spellings still read as the format the game promised", () => {
  // Escaped or not, what a player MEETS is `[OOC]: …` — the backslashes are
  // markup, and the test is that nothing else crept in.
  for (const m of ["hi", "hello there"]) {
    assert.equal(oocRowBody(m).replace(/\\/g, ""), oocBody(m));
    assert.equal(oocBody(m), `[OOC]: ${m}`);
  }
});

test("a multi-word line is not special-cased", () => {
  // The bug's worst property was that it depended on the message. Both
  // spellings must be a pure prefix, whatever the text.
  for (const m of ["hi", "hello there", "a|b", "**bold**", ""]) {
    assert.ok(oocBody(m).endsWith(m));
    assert.ok(oocRowBody(m).endsWith(m));
  }
});
