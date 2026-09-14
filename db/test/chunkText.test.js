// node --test over the Discord chunker. Run with `npm test --workspace=db`.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chunkMessage, DISCORD_MESSAGE_LIMIT } = require("../lib/chunkText");

test("short text is one chunk, untouched", () => {
  assert.deepEqual(chunkMessage("hello\n\nworld"), ["hello\n\nworld"]);
});

test("paragraphs pack together and split on blank lines", () => {
  const a = "a".repeat(1200);
  const b = "b".repeat(1200);
  const c = "c".repeat(300);
  assert.deepEqual(chunkMessage(`${a}\n\n${b}\n\n${c}`), [a, `${b}\n\n${c}`]);
});

test("a long single-newline roster never cuts inside a line", () => {
  const lines = [];
  for (let i = 0; i < 120; i += 1) lines.push(`Player${i} as Character ${i}, Some Role ✝ turn ${i}`);
  const text = `**Game Ended**\n\n**Who was who**\n${lines.join("\n")}`;
  const chunks = chunkMessage(text);
  assert.ok(chunks.length > 1);
  const seen = [];
  for (const chunk of chunks) {
    assert.ok(chunk.length <= DISCORD_MESSAGE_LIMIT);
    for (const line of chunk.split("\n")) if (line) seen.push(line);
  }
  const original = text.split("\n").filter(Boolean); // every line survives whole, in order
  assert.deepEqual(seen, original);
});

test("a single line over the cap is still hard-split", () => {
  const long = "x".repeat(3000);
  const chunks = chunkMessage(`intro\n${long}`);
  assert.deepEqual(chunks, ["intro", "x".repeat(2000), "x".repeat(1000)]);
});

// ---- The composer's limits: db/lib/say.js runs the split, Feed.js draws
// the count off the same module (db/lib/sayLimits.js), so they can't disagree.
const sayLimits = require("../lib/sayLimits");

test("sayLimits.js has zero requires, so it stays client-safe", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "sayLimits.js"), "utf8");
  assert.equal(
    /^\s*(const .*=\s*)?require\(/m.test(source),
    false,
    "db/lib/sayLimits.js must require nothing — the chat composer is a client component",
  );
});

test("one message stays one message, right up to the cap", () => {
  assert.equal(chunkMessage("x".repeat(1999)).length, 1);
  assert.equal(chunkMessage("x".repeat(2000)).length, 1);
  assert.equal(chunkMessage("x".repeat(2001)).length, 2);
});

test("a long list splits into as few pieces as it can", () => {
  const list = Array.from({ length: 300 }, (_, i) => `- item number ${i}`).join("\n");
  const pieces = chunkMessage(list);
  assert.ok(pieces.length <= sayLimits.MAX_SAY_PIECES, `expected ≤3 pieces, got ${pieces.length}`);
  assert.equal(pieces.join("\n"), list);
  for (const piece of pieces) assert.ok(piece.length <= sayLimits.MESSAGE_LIMIT);
});

test("a list splits between items, never through one", () => {
  const list = Array.from({ length: 300 }, (_, i) => `- item number ${i}`).join("\n");
  for (const piece of chunkMessage(list)) {
    assert.equal(piece.startsWith("- item"), true, "a piece must begin at an item");
    assert.match(piece, /item number \d+$/, "a piece must end at the end of an item");
  }
});

test("the ceiling is three pieces, and the refusal counts them", () => {
  assert.equal(sayLimits.MAX_SAY_PIECES, 3);
  assert.equal(chunkMessage("x".repeat(6000)).length, 3);
  assert.equal(chunkMessage("x".repeat(6001)).length, 4);
  assert.match(sayLimits.tooManyPieces(4), /4 messages/);
  assert.match(sayLimits.tooManyPieces(4), /3 or fewer/);
});

test("the count stays quiet until it is worth saying", () => {
  assert.ok(sayLimits.COUNT_FROM > 0);
  assert.ok(sayLimits.COUNT_FROM < sayLimits.MESSAGE_LIMIT, "silence must end before the cap does");
});
