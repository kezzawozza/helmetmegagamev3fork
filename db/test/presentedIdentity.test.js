// db/lib/presentedIdentity.js: the resolver that decides the name and face a
// room sees. Locks down that a hood the player CHOSE conceals exactly as hard
// as one tied on for them — the distinction every send path has to carry
// through unchanged.
const test = require("node:test");
const assert = require("node:assert/strict");
const { concealmentFrom, presentedIdentity } = require("../lib/presentedIdentity");

const speaker = { id: "c1", name: "Semyun Varyutskaya", age: 30, gender: "WOMAN", concealed: true };
const bareFaced = { ...speaker, concealed: false };

const hood = { equipped: true, tag: { name: "Hood", concealsIdentity: true, concealSprite: "hood", forcesConceal: false, equipLayer: 1 } };
const helm = { equipped: true, tag: { name: "Great Helm", concealsIdentity: true, concealSprite: "greathelm", forcesConceal: false, equipLayer: 2 } };
const sack = { equipped: true, tag: { name: "Sack", concealsIdentity: true, concealSprite: "sack", forcesConceal: true, equipLayer: 3 } };
const carried = { ...hood, equipped: false };

test("a hood the player chose conceals, and says so with the item's own face", () => {
  const identity = presentedIdentity(speaker, { forcedName: null, concealment: concealmentFrom([hood]) });
  assert.equal(identity.concealed, true);
  assert.equal(identity.name, "Woman");
  assert.equal(identity.alias, "Woman");
  assert.equal(identity.avatarPath, "/assets/helms/hood.webp");
});

test("the same hood carried rather than worn conceals nothing", () => {
  assert.equal(concealmentFrom([carried]), null);
  const identity = presentedIdentity(speaker, { forcedName: null, concealment: concealmentFrom([carried]) });
  assert.equal(identity.concealed, false);
  assert.equal(identity.name, "Semyun Varyutskaya");
});

test("gear worn by somebody who never asked to hide leaves them named", () => {
  const identity = presentedIdentity(bareFaced, { forcedName: null, concealment: concealmentFrom([hood]) });
  assert.equal(identity.concealed, false);
  assert.equal(identity.name, "Semyun Varyutskaya");
});

test("a sack tied on overrides the column — there is no choice to make", () => {
  const piece = concealmentFrom([sack]);
  assert.equal(piece.forced, true);
  const identity = presentedIdentity(bareFaced, { forcedName: null, concealment: piece });
  assert.equal(identity.concealed, true);
  assert.equal(identity.avatarPath, "/assets/helms/sack.webp");
});

test("the outermost piece is the one an onlooker sees", () => {
  assert.equal(concealmentFrom([hood, helm]).sprite, "greathelm");
  assert.equal(concealmentFrom([helm, hood]).sprite, "greathelm");
});

test("a forced name beats a hood, and a forced name is not hiding", () => {
  const identity = presentedIdentity(speaker, { forcedName: "Beast", concealment: concealmentFrom([hood]) });
  assert.equal(identity.name, "Beast");
  assert.equal(identity.alias, "Beast");
  assert.equal(identity.forced, true);
  assert.equal(identity.concealed, false);
});

test("a caller that loaded no tags falls back to the column, never to the name", () => {
  const identity = presentedIdentity(speaker);
  assert.equal(identity.concealed, true);
  assert.equal(identity.name, "Woman");
  assert.equal(identity.avatarPath, "/assets/letters/_default.webp"); // no idea what by
});

// --- reading a row back ----------------------------------------------------
const { wasHooded } = require("../lib/presentedIdentity");

test("a line said under a hood still reads as one — the sprite is frozen on the row", () => {
  assert.equal(wasHooded({ concealedAlias: "Woman", presentedAvatarPath: "/assets/helms/hood.webp" }), true);
});

test("a line said under an EXPIRED disguise is still not a hood", () => {
  const row = { concealedAlias: "Beast", presentedAvatarPath: "/assets/letters/B.webp" };
  assert.equal(wasHooded(row, { forcedName: null }), false);
  assert.equal(wasHooded(row, { forcedName: "Beast" }), false);
});

test("an ordinary line was never hidden at all", () => {
  assert.equal(wasHooded({ concealedAlias: null, presentedAvatarPath: null }), false);
  assert.equal(wasHooded(null), false);
});

test("an alias outside the nine settles it with no sprite to go on", () => {
  assert.equal(wasHooded({ concealedAlias: "Beast", presentedAvatarPath: null }), false);
});

test("a row too old to carry a face errs toward the hood", () => {
  assert.equal(wasHooded({ concealedAlias: "Old Woman", presentedAvatarPath: null }), true);
  assert.equal(wasHooded({ concealedAlias: "Old Woman", presentedAvatarPath: null }, { forcedName: "Old Woman" }), false);
});
