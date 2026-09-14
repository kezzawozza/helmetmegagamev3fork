// What lights a channel in the places column — the whole unread mark on
// /chat. Too NARROW and a GM with no character (`selfId` null) sees nothing
// light. Too WIDE and the mark stops meaning anything: `source: "SYSTEM"` is
// the game talking to itself, the one thing held back.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isNotableRow } = require("../../web/app/(app)/chat/feedStore.js");

const ME = "char-me";
const THEM = "char-them";
const PLACE = "loc:the-square";

function row(over = {}) { // only the fields the predicate reads
  return { source: "WEB", characterId: THEM, content: "Hello.", ...over };
}

test("somebody speaking lights the place", () => {
  assert.equal(isNotableRow(PLACE, row(), ME), true);
});

test("a line proxied out of Discord counts exactly as a typed one", () => {
  assert.equal(isNotableRow(PLACE, row({ source: "DISCORD" }), ME), true);
});

test("the game talking to itself does not", () => {
  assert.equal(isNotableRow(PLACE, row({ source: "SYSTEM", characterId: null }), ME), false);
});

test("your own words are not news", () => {
  assert.equal(isNotableRow(PLACE, row({ characterId: ME }), ME), false);
});

test("a GM with no character still sees speech", () => {
  assert.equal(isNotableRow(PLACE, row(), null), true);
  assert.equal(isNotableRow(PLACE, row(), undefined), true);
  assert.equal(isNotableRow(PLACE, row({ source: "SYSTEM", characterId: null }), null), false);
});

test("a conversation row and a mention still light, without being special-cased", () => {
  assert.equal(isNotableRow("conv:abc", row(), ME), true);
  assert.equal(isNotableRow(PLACE, row({ content: `hey {char:${ME}} over here` }), ME), true);
});

test("a row with no author is not assumed to be scenery", () => {
  // Scenery is identified by `source`, never a missing characterId — a
  // proxied line that never resolved to a character is still somebody speaking.
  assert.equal(isNotableRow(PLACE, row({ characterId: null }), ME), true);
});

test("nothing at all lights nothing", () => {
  assert.equal(isNotableRow(PLACE, null, ME), false);
  assert.equal(isNotableRow(PLACE, undefined, ME), false);
});
