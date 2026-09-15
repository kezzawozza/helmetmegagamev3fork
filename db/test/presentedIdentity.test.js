// db/lib/presentedIdentity.js: the resolver that decides the name and face a
// room sees. Locks down that a hood the player CHOSE conceals exactly as hard
// as one tied on for them — the distinction every send path has to carry
// through unchanged.
const test = require("node:test");
const assert = require("node:assert/strict");
const { concealmentFrom, presentedIdentity } = require("../lib/presentedIdentity");

const speaker = { id: "c1", name: "Semyun Varyutskaya", age: 30, gender: "WOMAN", concealed: true };
const bareFaced = { ...speaker, concealed: false };

// Headgear carries NO equipLayer — HEAD is a single slot (db/lib/equipSlots.js),
// so two of these can only be worn at once by a character the collapse pass
// has not reached yet. Body pieces are the layered ones now.
const hood = { equipped: true, tag: { name: "Hood", equipSlot: "HEAD", concealsIdentity: true, concealSprite: "hood", forcesConceal: false, equipLayer: null } };
const helm = { equipped: true, tag: { name: "Great Helm", equipSlot: "HEAD", concealsIdentity: true, concealSprite: "greathelm", forcesConceal: false, equipLayer: null } };
const sack = { equipped: true, tag: { name: "Sack", equipSlot: "HEAD", concealsIdentity: true, concealSprite: "sack", forcesConceal: true, equipLayer: null } };
const cloak = { equipped: true, tag: { name: "Cloak", equipSlot: "BODY", concealsIdentity: true, concealSprite: "cloak", forcesConceal: false, equipLayer: 2 } };
const robe = { equipped: true, tag: { name: "Robe", equipSlot: "BODY", concealsIdentity: true, concealSprite: "robe", forcesConceal: false, equipLayer: 1 } };
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
  // A head piece beats a body one: a hood covers a face, a cloak does not.
  assert.equal(concealmentFrom([cloak, hood]).sprite, "hood");
  assert.equal(concealmentFrom([hood, cloak]).sprite, "hood");
  // and within the body, Over beats Mail.
  assert.equal(concealmentFrom([robe, cloak]).sprite, "cloak");
  assert.equal(concealmentFrom([cloak, robe]).sprite, "cloak");
});

// The bug this guards: ordering used to be Tag.equipLayer alone, highest
// wins. Once HEAD stopped being layered every head piece tied at 0, so the
// winner was whichever row the query happened to return first and a
// character's face could change between two reloads. Both orders must agree.
test("two head pieces at once resolve to the same face whichever order they arrive in", () => {
  const a = concealmentFrom([hood, helm]).sprite;
  const b = concealmentFrom([helm, hood]).sprite;
  assert.equal(a, b);
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
