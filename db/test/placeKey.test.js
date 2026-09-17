// The place-key grammar, and the one kind whose id is not a row id. A place
// key is the string both faces agree on for WHERE something was said.
// `net:27.065` is the case worth pinning: every other kind's id is a cuid,
// and this one is a registry slug WITH A DOT IN IT — parsePlaceKey splits on
// the FIRST colon precisely so an id may contain anything but that.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  placeKeyForNet,
  placeKeyForZone,
  parsePlaceKey,
  isScenePlaceKey,
  isOocPlaceKey,
} = require("../lib/placeKey");
const { SPECIAL_CHANNELS } = require("../lib/specialChannels");

test("a net key round-trips, dot and all", () => {
  const key = placeKeyForNet("27.065");
  assert.equal(key, "net:27.065");
  assert.deepEqual(parsePlaceKey(key), { kind: "net", id: "27.065" });
});

test("every registered special channel has a parseable key", () => {
  for (const entry of SPECIAL_CHANNELS) {
    const parsed = parsePlaceKey(placeKeyForNet(entry.slug));
    assert.ok(parsed, `${entry.slug} produced an unparseable place key`);
    assert.equal(parsed.kind, "net");
    assert.equal(parsed.id, entry.slug, "the id must be the slug the registry uses");
  }
});

test("the four older kinds still parse, and a bogus kind still does not", () => {
  assert.deepEqual(parsePlaceKey("zone:abc123"), { kind: "zone", id: "abc123" });
  assert.equal(parsePlaceKey("nets:abc"), null);
  assert.equal(parsePlaceKey("net:"), null);
  assert.equal(parsePlaceKey("net"), null);
  assert.equal(parsePlaceKey(null), null);
});

test("a radio net is not a scene", () => {
  assert.equal(isScenePlaceKey(placeKeyForNet("27.065")), false);
  assert.equal(isScenePlaceKey(placeKeyForZone("abc123")), false);
});

// The whole point of the second predicate: the two places a shout cannot reach
// are places an OOC line can, because an OOC line is not the character talking.
test("a net and a summary take an OOC line even though they take no shout", () => {
  assert.equal(isOocPlaceKey(placeKeyForNet("27.065")), true);
  assert.equal(isOocPlaceKey(placeKeyForZone("abc123")), true);
  assert.equal(isOocPlaceKey("room:abc"), true);
  assert.equal(isOocPlaceKey("conv:abc"), true);
  // No composer in either, so nothing to type one into.
  assert.equal(isOocPlaceKey("loc:abc"), false);
  assert.equal(isOocPlaceKey("dead:main"), false);
  assert.equal(isOocPlaceKey(null), false);
});
