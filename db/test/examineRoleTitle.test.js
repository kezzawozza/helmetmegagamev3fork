// Which seats a look reads off somebody (db/lib/examine.js, Role.examineVisible).
// Most of them are public offices, so the title shows; the two Brigands and the
// two Tribunal seats carry `examine_visible: false` in docs/roles.yaml and show
// nothing at all, the same as a character with no seat. Run with
// `npm test --workspace=db`. Nothing here touches Prisma — examineReadout,
// presentedStateFrom and rehydrateSubject are all pure.
const test = require("node:test");
const assert = require("node:assert/strict");
const { examineReadout } = require("../lib/examine");
const { presentedStateFrom, readPresentedState, rehydrateSubject } = require("../lib/examineSnapshot");

// A hood: concealsIdentity + a sprite + a layer, the three concealmentFrom reads.
const HOOD = {
  name: "Sackcloth Hood",
  slug: "hood",
  category: "Items",
  inspectVisibility: "WORN",
  concealsIdentity: true,
  concealSprite: "hood.webp",
  forcesConceal: false,
  equipLayer: 3,
  requirementSkills: [],
};

// What a Disguise Kit mints: a false name over a face nobody is hiding.
const DISGUISE = {
  name: "Disguise",
  slug: "custom-disguise-tomas-vell",
  category: "Items",
  inspectVisibility: "HIDDEN",
  forcedName: "Tomas Vell",
  requirementSkills: [],
};

const held = (tag, equipped = false) => ({ equipped, expiresTurn: null, tag });

// The character as a WRITER loads them (db/lib/examineSnapshot.js#PRESENTED_STATE_SELECT).
const speaker = ({ roleTitle = "Sheriff", examineVisible = true, groupSlug = "soil", tags = [], concealed = false } = {}) => ({
  name: "Ivo Brandt",
  appearance: "Heavyset, sunburnt.",
  concealed,
  roleTitle,
  role: roleTitle ? { examineVisible, groupSlug } : null,
  tags: tags.map((ct) => ({ tagId: ct.tag.slug, equipped: ct.equipped, expiresTurn: null, quantity: 1, tag: ct.tag })),
});

const live = { id: "c1", name: "Ivo Brandt", age: 44, gender: "MAN", updatedAt: new Date(0) };

// Say a line, then look at it — the whole path, the way examineRow.js walks it.
function look(over = {}) {
  const character = speaker(over);
  const state = readPresentedState(presentedStateFrom(character));
  const catalog = (over.tags ?? []).map((ct) => ({ id: ct.tag.slug, ...ct.tag }));
  const subject = rehydrateSubject({ live, state, tags: catalog });
  return examineReadout({ subject, openTurnNumber: 9 });
}

test("a public office is read off a look", () => {
  assert.equal(look().roleTitle, "Sheriff");
});

test("the title is painted in its estate's colour", () => {
  assert.equal(look().roleGroup, "soil");
});

test("a seat in an uncoloured group is read, but wears no colour", () => {
  const readout = look({ roleTitle: "Mercenary", groupSlug: "outsiders" });
  assert.equal(readout.roleTitle, "Mercenary");
  assert.equal(readout.roleGroup, null);
});

test("a seat that lives on not being known reads as nothing", () => {
  const readout = look({ roleTitle: "Brigand", examineVisible: false });
  assert.equal(readout.roleTitle, null);
});

test("no seat at all reads the same as an opaque one", () => {
  assert.equal(look({ roleTitle: null }).roleTitle, null);
});

test("the title is the character's own, not the catalog's name for the seat", () => {
  // A GM hand-edits Character.roleTitle; that is what the room knows them as.
  assert.equal(look({ roleTitle: "Disgraced Knight" }).roleTitle, "Disgraced Knight");
});

test("under a hood: no name, and no office either", () => {
  const readout = look({ tags: [held(HOOD, true)], concealed: true });
  assert.equal(readout.concealed, true);
  assert.equal(readout.roleTitle, undefined);
});

test("a false name is not a hood, and the office is still read", () => {
  const readout = look({ tags: [held(DISGUISE)] });
  assert.equal(readout.name, "Tomas Vell");
  assert.equal(readout.roleTitle, "Sheriff");
});

test("a raw character row leaks nothing — only the frozen field is read", () => {
  // The shape examine.js must never trust: a title with no visibility attached.
  const readout = examineReadout({
    subject: { id: "c2", name: "Ivo Brandt", appearance: "Heavyset.", concealed: false, roleTitle: "Brigand", tags: [] },
    openTurnNumber: 9,
  });
  assert.equal(readout.roleTitle, null);
});
