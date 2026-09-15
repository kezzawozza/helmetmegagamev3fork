// normalizeChannelName — the small function the whole adopt-before-create rule
// rests on. Discord rewrites a channel name on the way in, so "The Old Mill"
// comes back as "the-old-mill". Compare the two as typed and every run decides
// nothing by that name exists and cuts another channel; do that on a hundred
// Locations and the guild doubles overnight.
const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeChannelName, channelKey, threadKey } = require("../lib/discordMirror/live");

test("lowercases and hyphenates the way Discord does", () => {
  assert.equal(normalizeChannelName("The Old Mill"), "the-old-mill");
  assert.equal(normalizeChannelName("TOWN SQUARE"), "town-square");
  assert.equal(normalizeChannelName("already-fine"), "already-fine");
});

test("drops the punctuation Discord will not keep", () => {
  assert.equal(normalizeChannelName("The Old Mill!"), "the-old-mill");
  assert.equal(normalizeChannelName("27.065"), "27065");
  assert.equal(normalizeChannelName("Sister's Rest"), "sisters-rest");
  assert.equal(normalizeChannelName("keeps_underscores"), "keeps_underscores");
});

test("collapses hyphen runs and trims the ends", () => {
  assert.equal(normalizeChannelName("  spaced  out  "), "spaced-out");
  assert.equal(normalizeChannelName("a -- b"), "a-b");
  assert.equal(normalizeChannelName("--edges--"), "edges");
});

test("cuts at Discord's 100 characters", () => {
  assert.equal(normalizeChannelName("x".repeat(140)).length, 100);
});

test("is stable: normalizing an already-normalized name changes nothing", () => {
  for (const name of ["The Old Mill!", "27.065", "  spaced  out  ", "Sister's Rest"]) {
    const once = normalizeChannelName(name);
    assert.equal(normalizeChannelName(once), once, name);
  }
});

test("survives a name that normalizes to nothing", () => {
  assert.equal(normalizeChannelName("!!!"), "");
  assert.equal(normalizeChannelName(null), "");
});

test("a category's name is NOT normalized — Discord keeps its case and spaces", () => {
  assert.equal(channelKey(4, null, "Town"), "4::Town");
  assert.equal(channelKey(0, "99", "Town"), "0:99:town");
});

test("the key separates two channels of the same name under different parents", () => {
  assert.notEqual(channelKey(0, "1", "square"), channelKey(0, "2", "square"));
});

test("a thread's name is stored as typed, only cut at 100", () => {
  assert.equal(threadKey("1", "The Old Mill"), "1:The Old Mill");
  assert.equal(threadKey("1", "y".repeat(140)).length, 2 + 100);
});
