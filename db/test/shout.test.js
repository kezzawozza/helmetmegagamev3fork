// node --test over db/lib/shout.js#shoutParts — the distance ladder.
const test = require("node:test");
const assert = require("node:assert/strict");
const { shoutParts, renderShout } = require("../lib/shout");

test("your own Location hears the words whole", () => {
  assert.equal(shoutParts("Run!", 0, null).text, "You hear someone shout: » Run!");
});

test("one hop away hears the words clear, with the direction", () => {
  assert.equal(shoutParts("Run!", 1, "the Gate").text, "You hear someone shout from the direction of the Gate: » Run!");
});

test("two hops away hears static of the same length", () => {
  const { text } = shoutParts("Run now", 2, "the Gate");
  assert.match(text, /^You hear someone shout from the direction of the Gate: » .{7}$/);
});

test("Discord's line carries the very same static as Chat's row", () => {
  // One roll per audience: if the two faces blanked different letters, a
  // reader watching both could piece the words back together.
  for (let i = 0; i < 20; i += 1) {
    const parts = shoutParts("meet me by the old well at dawn", 2, "the Gate");
    assert.equal(renderShout(parts, 2), `-# ${parts.text}`);
  }
  const near = shoutParts("Run!", 0, null);
  assert.equal(renderShout(near, 0), near.text);
});

test("three hops away hears only that someone shouted, and which way", () => {
  assert.equal(shoutParts("Run!", 3, "the Gate").text, "You hear someone shout from the direction of the Gate.");
  assert.equal(shoutParts("Run!", 3, null).text, "You hear someone shout somewhere nearby.");
});

// A mention inside a shout, and why it stops being a mention two hops out (db/lib/shout.js).
//
// shout() picks the body per distance: the `{char:…}` spelling near, the flattened one far. This pins the
// reason. A token run through the static comes out as broken braces with the named person's name sitting
// perfectly readable in the middle of a redacted sentence — the one word the distance was there to take away.
const { tokensToNames } = require("../lib/characterMentions");

test("near enough to hear the words, the token is still a token", () => {
  const row = "{char:p1|Ada} help";
  assert.equal(shoutParts(row, 0, null).text, "You hear someone shout: » {char:p1|Ada} help");
  assert.ok(shoutParts(row, 1, "the Gate").text.includes("{char:p1|Ada}"));
});

test("the static never gets a token to chew on", () => {
  const flat = tokensToNames("{char:p1|Ada} help");
  for (let i = 0; i < 20; i += 1) {
    const { text } = shoutParts(flat, 2, "the Gate");
    assert.ok(!text.includes("{char:"), text);
    assert.ok(!text.includes("}"), text);
  }
});

test("the flattened body is the same LENGTH the static expects", () => {
  // Muffling blanks characters one for one, so the far row must be built from prose, never from a token
  // that happens to be longer than the name it prints.
  const flat = tokensToNames("{char:p1|Ada} help");
  assert.equal(flat, "Ada help");
  assert.match(shoutParts(flat, 2, "the Gate").text, /: » .{8}$/);
});

// The place gate the three moment-to-moment verbs share (db/lib/placeKey.js).
// Both faces ask this one question, so a drift between them fails here first.
const { isScenePlaceKey } = require("../lib/placeKey");

test("a room and a conversation are scenes", () => {
  assert.equal(isScenePlaceKey("room:abc"), true);
  assert.equal(isScenePlaceKey("conv:abc"), true);
});

test("the street and the zone summary are not", () => {
  assert.equal(isScenePlaceKey("loc:abc"), false);
  assert.equal(isScenePlaceKey("zone:abc"), false);
});

test("a missing or malformed key is not a scene", () => {
  for (const key of [null, undefined, "", "room:", ":abc", "nonsense", 7]) {
    assert.equal(isScenePlaceKey(key), false);
  }
});

// ---------------------------------------------------------------- the name

// shouterNameFor is where the whole distance-0 naming rule lives, and it needs
// no database, so it is pinned here.
const { shouterNameFor, deliverShout } = require("../lib/shout");

test("a hood shouts as a lower-case subject, not as a Title Case name", () => {
  // identity.name is Title Case because it is a webhook username; mid-sentence
  // that reads as somebody actually called Young Man.
  const character = { age: 22, gender: "MAN" };
  const name = shouterNameFor(character, { concealed: true, name: "Young Man" });
  assert.equal(name, "A young man");
});

test("a forced name and a real name both come straight off the identity", () => {
  assert.equal(shouterNameFor({}, { concealed: false, name: "Beast" }), "Beast");
  assert.equal(shouterNameFor({}, { concealed: false, name: "Ada" }), "Ada");
});

test("no identity leaves the anonymous line standing", () => {
  assert.equal(shouterNameFor({}, null), null);
  assert.equal(shouterNameFor({}, { concealed: false, name: "" }), null);
});

test("distance zero names the shouter, and says when it is muffled", () => {
  assert.equal(
    shoutParts("Run!", 0, null, { shouterName: "Beast" }).text,
    "Beast shouts: » Run!",
  );
  assert.equal(
    shoutParts("Run!", 0, null, { shouterName: "Beast", muffled: true }).text,
    "Beast shouts: » Run!, but it's muffled.",
  );
  // Falling back to anonymous is the point: erring toward hiding somebody who
  // should be visible beats naming somebody who should not be.
  assert.equal(
    shoutParts("Run!", 0, null, { muffled: true }).text,
    "You hear someone shout: » Run!, but it's muffled.",
  );
});

// ------------------------------------------------------------ the delivery

// shoutAudience is the de-duplication rule on its own: which of `heard` still
// needs delivering once the place the shout was MADE in has been.
const { shoutAudience } = require("../lib/shout");

test("a shout made from a Location does not deliver to it twice", () => {
  // soundRange counts the shouter's own Location at distance 0, so a caller
  // shouting from a `loc:` key — the turn engine's Xom scream — names it once
  // as `here` and again as heard[0]. It used to write and post both.
  const heard = [
    { placeKey: "loc:home", name: "Home" },
    { placeKey: "loc:next", name: "Next" },
  ];
  assert.deepEqual(
    shoutAudience("loc:home", heard).map((place) => place.placeKey),
    ["loc:next"],
  );
});

test("a shout made from a room or a conversation can never collide", () => {
  const heard = [
    { placeKey: "loc:home", name: "Home" },
    { placeKey: "loc:next", name: "Next" },
  ];
  for (const origin of ["room:vault", "conv:abc"]) {
    assert.deepEqual(
      shoutAudience(origin, heard).map((place) => place.placeKey),
      ["loc:home", "loc:next"],
    );
  }
});

test("a sealed room hears nobody around it, and that is not an error", () => {
  assert.deepEqual(shoutAudience("room:vault", []), []);
  assert.deepEqual(shoutAudience("room:vault"), []);
});
