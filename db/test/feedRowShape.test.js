// node --test over db/lib/archive.js#feedRowShape — which face a feed row
// wears, and which handle it hands the browser for the person behind it.
const test = require("node:test");
const assert = require("node:assert/strict");

// Set before the module is required, since that's the only stable point for an HMAC key.
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret";
const { feedRowShape } = require("../lib/archive");

const base = { seq: 1n, placeKey: "location:abc", characterId: "c1", characterName: "Sir Alder", content: "hi" };

test("a bare-faced row carries no path, so the client asks for their own face", () => {
  const row = feedRowShape({ ...base });
  assert.equal(row.avatarPath, null);
  assert.equal(row.unknownFace, false);
  assert.equal(row.name, "Sir Alder");
});

test("a bare-faced row keeps its character id and gets no key", () => {
  const row = feedRowShape({ ...base });
  assert.equal(row.characterId, "c1");
  assert.equal(row.speakerKey, null);
});

test("a masked row wears the frozen helm", () => {
  const row = feedRowShape({
    ...base,
    concealedAlias: "Young Man",
    presentedAvatarPath: "/assets/helms/silvermask.webp",
  });
  assert.equal(row.avatarPath, "/assets/helms/silvermask.webp");
  assert.equal(row.unknownFace, false);
  assert.equal(row.name, "Young Man");
});

test("a forced name wears the frozen plaque", () => {
  const row = feedRowShape({ ...base, concealedAlias: "Beast", presentedAvatarPath: "/assets/letters/B.webp" });
  assert.equal(row.avatarPath, "/assets/letters/B.webp");
});

test("a row from before the column keeps its secret rather than guessing", () => {
  const row = feedRowShape({ ...base, concealedAlias: "Young Man" });
  assert.equal(row.avatarPath, null);
  assert.equal(row.unknownFace, true);
});

test("an aliased row withholds the character id and hands a key instead", () => {
  const row = feedRowShape({ ...base, concealedAlias: "Young Man" });
  assert.equal(row.characterId, null);
  assert.equal(typeof row.speakerKey, "string");
  assert.notEqual(row.speakerKey, "c1");
});

test("one speaker's hooded rows share a key, so a run still groups", () => {
  const a = feedRowShape({ ...base, seq: 1n, concealedAlias: "Young Man" });
  const b = feedRowShape({ ...base, seq: 2n, concealedAlias: "Young Man" });
  assert.equal(a.speakerKey, b.speakerKey);
});

test("two speakers under the same alias do not share a key", () => {
  const a = feedRowShape({ ...base, concealedAlias: "Young Man" });
  const b = feedRowShape({ ...base, characterId: "c2", concealedAlias: "Young Man" });
  assert.notEqual(a.speakerKey, b.speakerKey);
});

test("an aliased row carries no avatar version, even when the caller supplies one", () => {
  const row = feedRowShape({ ...base, concealedAlias: "Young Man" }, { avatarVersion: 1234 });
  assert.equal(row.avatarVersion, null);
});

test("a bare-faced row takes the caller's avatar version", () => {
  const row = feedRowShape({ ...base }, { avatarVersion: 1234 });
  assert.equal(row.avatarVersion, 1234);
});
