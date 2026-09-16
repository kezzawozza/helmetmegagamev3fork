// What counts as out of character in a spoken message (db/lib/oocGuard.js).
// The word test is the fiddly half: "ooc" standing alone is the tell, and a
// letter run that merely CONTAINS those three letters is not — a rule that
// caught "poockie" would refuse a perfectly ordinary sentence and send the
// player a DM about it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { containsOoc, oocRejectionDm, OOC_REFUSAL } = require("../lib/oocGuard");

test("ordinary speech goes through", () => {
  for (const line of [
    "Is Mountaineering the skill I need for the Road by the Keep?",
    "I'll meet you at the forge.",
    "Three crates, no more.",
  ]) {
    assert.equal(containsOoc(line), false, line);
  }
});

test("a parenthesis, a bracket or the bare word is caught", () => {
  for (const line of [
    "(sorry, brb)",
    "[afk a sec]",
    "ooc what turn is it",
    "Sure. OOC: is this allowed?",
    "no wait ooc",
  ]) {
    assert.equal(containsOoc(line), true, line);
  }
});

test("a letter run containing ooc is not the word ooc", () => {
  for (const line of ["I bought a poockie", "cooct", "loocy", "Moocher", "spooocky"]) {
    assert.equal(containsOoc(line), false, line);
  }
});

test("empty and missing text are not OOC", () => {
  assert.equal(containsOoc(""), false);
  assert.equal(containsOoc(null), false);
  assert.equal(containsOoc(undefined), false);
});

test("the DM hands the whole message back", () => {
  const typed = "(hey are we starting yet)";
  const body = oocRejectionDm(typed);
  assert.ok(body.includes(typed), "the player's own text must survive the refusal");
  assert.ok(body.includes(OOC_REFUSAL));
  assert.ok(body.includes("/ooc"));
});

test("every line the DM quotes carries the chevron", () => {
  // web/lib/discordGuild.js#sendDm applies `»` to the first line and
  // bot/src/lib/dm.js does not, so the body writes its own — and must already
  // start with one, or the web's idempotent pass would add a second.
  const body = oocRejectionDm("hello");
  assert.ok(body.startsWith("»"));
  assert.ok(body.includes("» hello"));
});
