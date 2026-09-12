const test = require("node:test");
const assert = require("node:assert");
const {
  ACT,
  SPEAK,
  SHOUT,
  blockerFor,
  slugsBlocking,
} = require("../lib/incapacitation");

// The seam, not the table. These assert the three distinctions the game
// actually turns on, so a later edit to RESTRICTIONS that collapses two of
// them fails here rather than in a channel.

const held = (...slugs) => slugs.map((slug) => ({ slug, name: slug }));

test("Mute takes the yell and leaves the voice", () => {
  assert.equal(blockerFor(held("mute"), SPEAK), null);
  assert.equal(blockerFor(held("mute"), ACT), null);
  assert.equal(blockerFor(held("mute"), SHOUT)?.slug, "mute");
});

test("being out cold takes the yell and leaves the typing", () => {
  // unconscious, paralyzed and seizure used to block SPEAK too, which
  // stranded a player who had no way to say OOC that they were out. They
  // still can't shout.
  assert.equal(blockerFor(held("unconscious"), SPEAK), null);
  assert.equal(blockerFor(held("unconscious"), SHOUT)?.slug, "unconscious");
  assert.equal(blockerFor(held("paralyzed"), SPEAK), null);
  assert.equal(blockerFor(held("paralyzed"), SHOUT)?.slug, "paralyzed");
  assert.equal(blockerFor(held("seizure"), SPEAK), null);
  assert.equal(blockerFor(held("seizure"), SHOUT)?.slug, "seizure");
});

test("a hostage can still yell for help", () => {
  assert.equal(blockerFor(held("bound"), ACT)?.slug, "bound");
  assert.equal(blockerFor(held("bound"), SPEAK), null);
  assert.equal(blockerFor(held("bound"), SHOUT), null);
});

test("Catatonic never blocks speech, or the tag seals itself shut", () => {
  // db/lib/catatonicDeathPass.js kills for inactivity, and talking is what
  // lifts the tag. Gate it and the player can never get out.
  assert.equal(blockerFor(held("catatonic-afk"), SPEAK), null);
  assert.equal(blockerFor(held("catatonic-afk"), SHOUT), null);
});

test("blockerFor reads both tag shapes", () => {
  // Callers arrive through different includes: some hand down
  // { tag: { slug } } rows, the fallback query hands down bare ones.
  assert.equal(blockerFor([{ tag: { slug: "mute", name: "Mute" } }], SHOUT)?.name, "Mute");
  assert.equal(blockerFor([{ slug: "mute" }], SHOUT)?.name, "mute");
});

test("VOICE_SLUGS gets the superset it is built from", () => {
  // db/lib/say.js builds its one query off slugsBlocking(SHOUT).
  const shout = slugsBlocking(SHOUT);
  assert.ok(shout.includes("mute"));
  assert.ok(shout.includes("paralyzed"));
  assert.ok(shout.includes("unconscious"));
  assert.ok(shout.includes("seizure"));
});

test("SPEAK is a deliberately empty column", () => {
  // Nothing in the game silences ordinary speech any more — see the header
  // comment in db/lib/incapacitation.js for why paralyzed/seizure/unconscious
  // were pulled out of it. Re-adding a slug here should be a conscious edit
  // to RESTRICTIONS, not something this test lets slide by accident.
  assert.deepEqual(slugsBlocking(SPEAK), []);
});
