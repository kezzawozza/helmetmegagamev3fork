// The freeze that makes a look answer for the MOMENT you saw somebody
// (db/lib/examineSnapshot.js). Locks down a real bug: examining somebody read
// their gear live, so a cultist could rob up hours after a line was said and
// every old line showed the robes to anyone who clicked the eye. Prisma-free
// on purpose, like presentedIdentity.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  presentedStateFrom,
  readPresentedState,
  rehydrateSubject,
} = require("../lib/examineSnapshot");
const { examineReadout } = require("../lib/examine");

const catalogTag = (over) => ({
  id: over.id,
  name: over.name,
  slug: over.slug ?? over.id,
  category: over.category ?? "Items",
  inspectVisibility: over.inspectVisibility ?? "ALWAYS",
  forcedName: over.forcedName ?? null,
  concealsIdentity: over.concealsIdentity ?? false,
  concealSprite: over.concealSprite ?? null,
  forcesConceal: false,
  equipLayer: over.equipLayer ?? null,
  requirementGambit: false,
  requirementTurns: null,
  requirementPerTurn: null,
  requirementResources: null,
  requirementItems: null,
  requirementSkills: [],
  armorMelee: null,
  armorBallistic: null,
});

const SWORD = catalogTag({ id: "t-sword", name: "Sword", slug: "sword" });
const ROBES = catalogTag({
  id: "t-robes",
  name: "Black Robes",
  slug: "black-robes",
  concealsIdentity: true,
  concealSprite: "hood",
  equipLayer: 3,
});
const KIT = catalogTag({ id: "t-kit", name: "Disguise Kit", slug: "disguise-kit", forcedName: "Tomas Vell" });

const speaker = (tags) => ({
  name: "Semyun Varyutskaya",
  appearance: "Tall, with a burn along one jaw.",
  roleTitle: null,
  resources: 4,
  factionId: null,
  concealed: false,
  tags,
});

const held = (tag, { equipped = false, expiresTurn = null } = {}) => ({
  tagId: tag.id,
  equipped,
  expiresTurn,
  tag: { forcedName: tag.forcedName, name: tag.name, concealsIdentity: tag.concealsIdentity, concealSprite: tag.concealSprite, forcesConceal: false, equipLayer: tag.equipLayer },
});

const live = { id: "c1", name: "Semyun Varyutskaya", age: 30, gender: "WOMAN", updatedAt: new Date(0) };

const roundTrip = (character) => readPresentedState(presentedStateFrom(character));

test("a look answers for the line, not for what they are wearing now", () => {
  const state = roundTrip(speaker([held(SWORD, { equipped: true })])); // room saw a sword, no robes
  const subject = rehydrateSubject({ live, state, tags: [SWORD, ROBES] }); // catalog at LOOK time holds robes too

  const readout = examineReadout({ subject, openTurnNumber: 9 });
  const names = readout.tags.map((row) => row.name);
  assert.deepEqual(names, ["Sword"]);
  assert.equal(readout.concealed, false);
  assert.equal(readout.name, "Semyun Varyutskaya");
});

test("the tag list is replaced, never merged with the live one", () => {
  const state = roundTrip(speaker([held(SWORD, { equipped: true })]));
  const subject = rehydrateSubject({
    live: { ...live, tags: [{ equipped: true, expiresTurn: null, tag: ROBES }] },
    state,
    tags: [SWORD, ROBES],
  });
  assert.equal(subject.tags.length, 1);
  assert.equal(subject.tags[0].tag.name, "Sword");
});

test("a tag since deleted from the catalog drops out rather than throwing", () => {
  const state = roundTrip(speaker([held(SWORD, { equipped: true }), held(ROBES, { equipped: true })]));
  const subject = rehydrateSubject({ live, state, tags: [SWORD] });
  assert.deepEqual(subject.tags.map((row) => row.tag.name), ["Sword"]);
});

test("a hood frozen on the line still reads as a hood after it comes off", () => {
  const state = roundTrip({ ...speaker([held(ROBES, { equipped: true })]), concealed: true });
  const subject = rehydrateSubject({ live, state, tags: [ROBES] }); // catalog still has them; character doesn't wear them
  const readout = examineReadout({ subject, openTurnNumber: 9 });
  assert.equal(readout.concealed, true);
  assert.equal(readout.appearance, null);
});

test("a forced name frozen on the line survives the kit expiring", () => {
  const state = roundTrip(speaker([held(KIT, { expiresTurn: 12 })]));
  const subject = rehydrateSubject({ live, state, tags: [KIT] });
  const readout = examineReadout({ subject, openTurnNumber: 10 });
  assert.equal(readout.concealed, false); // being something, not hiding — ordinary read under the forced name
  assert.equal(readout.name, "Tomas Vell");
});

test("a duration counts against the turn the line was said in", () => {
  const state = roundTrip(speaker([held(KIT, { expiresTurn: 12 })]));
  const subject = rehydrateSubject({ live, state, tags: [KIT] });
  const row = examineReadout({ subject, openTurnNumber: 10 }).tags.find((t) => t.slug === "disguise-kit"); // read at the turn it was said
  assert.match(row.detail ?? "", /3 turns/);
});

test("the name and the appearance come off the snapshot", () => {
  const state = roundTrip(speaker([]));
  const subject = rehydrateSubject({ live: { ...live, name: "Renamed Later" }, state, tags: [] });
  assert.equal(subject.name, "Semyun Varyutskaya");
  assert.equal(subject.appearance, "Tall, with a burn along one jaw.");
});

test("readPresentedState refuses anything it does not recognise", () => {
  assert.equal(readPresentedState(null), null);
  assert.equal(readPresentedState(undefined), null);
  assert.equal(readPresentedState({}), null);
  assert.equal(readPresentedState({ v: 2, t: [] }), null);
  assert.equal(readPresentedState("{}"), null);
  assert.equal(readPresentedState([]), null);
  assert.equal(readPresentedState({ v: 1 }), null);
});

test("readPresentedState survives junk inside a well-formed payload", () => {
  const state = readPresentedState({ v: 1, n: 7, a: null, r: null, s: "x", f: null, c: 1, t: [null, ["ok", 1, 3], [4, 1, 1], ["bad", 0, "soon"]] });
  assert.equal(state.name, null);
  assert.equal(state.resources, null);
  assert.equal(state.concealed, true);
  assert.deepEqual(state.tags, [
    { tagId: "ok", equipped: true, expiresTurn: 3 },
    { tagId: "bad", equipped: false, expiresTurn: null },
  ]);
});
