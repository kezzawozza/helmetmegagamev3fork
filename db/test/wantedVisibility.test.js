// node --test over the `visible: named` rule: a Wanted man is read as wanted
// only while he is going under his own name. Run with
// `npm test --workspace=db`. Nothing here touches Prisma — examineReadout and
// seenByBystander are both pure.
const test = require("node:test");
const assert = require("node:assert/strict");
const { seenByBystander } = require("../lib/medicalVision");
const { examineReadout } = require("../lib/examine");
const { matchesTypedName } = require("../lib/characterName");
const { warrantTargets, unwarrantTargets } = require("../lib/wanted");

const WANTED = {
  name: "Wanted",
  slug: "wanted",
  category: "General",
  inspectVisibility: "NAMED",
  requirementSkills: [],
};

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

// What a Disguise Kit mints: an ordinary hidden tag carrying a forcedName.
const DISGUISE = {
  name: "Disguise",
  slug: "custom-disguise-kellen-ward",
  category: "Items",
  inspectVisibility: "HIDDEN",
  forcedName: "Kellen Ward",
  requirementSkills: [],
};

// `concealed` is the player's WISH; it only takes effect while a concealing
// piece is equipped (db/lib/presentedIdentity.js). Both are needed, so the
// hooded case below passes it.
function subject(tags, { concealed = false } = {}) {
  return {
    id: "c1",
    name: "Sir Jorren \"the Blind\" Vask",
    appearance: "Tall.",
    concealed,
    age: 40,
    gender: "MAN",
    tags,
  };
}

const held = (tag, equipped = false) => ({ equipped, expiresTurn: null, tag });

test("the gate itself: NAMED follows the name, ALWAYS and WORN do not", () => {
  assert.equal(seenByBystander(WANTED, held(WANTED), true), true);
  assert.equal(seenByBystander(WANTED, held(WANTED), false), false);
  // Nobody passing the third argument keeps the old behaviour exactly.
  assert.equal(seenByBystander(WANTED, held(WANTED)), true);
  assert.equal(seenByBystander({ inspectVisibility: "ALWAYS" }, {}, false), true);
  assert.equal(seenByBystander({ inspectVisibility: "WORN" }, { equipped: true }, false), true);
  assert.equal(seenByBystander({ inspectVisibility: "HIDDEN" }, {}, true), false);
});

test("bare-faced: Wanted is read off the man", () => {
  const out = examineReadout({ subject: subject([held(WANTED)]) });
  assert.equal(out.concealed, false);
  assert.deepEqual(out.tags.map((t) => t.slug), ["wanted"]);
});

test("under a hood: no name, and no warrant either", () => {
  const out = examineReadout({
    subject: subject([held(WANTED), held(HOOD, true)], { concealed: true }),
  });
  assert.equal(out.concealed, true);
  // The concealed read files non-Health rows under `equipment`, not `tags` —
  // which is where this used to leak.
  assert.equal(out.equipment.includes("Wanted"), false);
  assert.equal(out.ailments.includes("Wanted"), false);
  assert.deepEqual(out.tags, []);
  // The hood itself still shows. Hiding the man is not hiding his gear.
  assert.equal(out.equipment.includes("Sackcloth Hood"), true);
});

test("under a Disguise Kit's false name: read as somebody else, and not as wanted", () => {
  const out = examineReadout({ subject: subject([held(WANTED), held(DISGUISE)]) });
  assert.equal(out.concealed, false);
  assert.equal(out.name, "Kellen Ward");
  assert.equal(
    out.tags.some((t) => t.slug === "wanted"),
    false,
  );
});

test("a photograph of a hooded man does not name him later", () => {
  const out = examineReadout({
    subject: subject([held(WANTED)]),
    wasConcealedAs: "an unknown young man",
  });
  assert.equal(out.concealed, true);
  assert.equal(out.equipment.includes("Wanted"), false);
});

test("the warrant matches a whole name, either way it is written", () => {
  const jorren = { name: "Sir Jorren \"the Blind\" Vask", firstName: "Jorren", lastName: "Vask" };
  assert.equal(matchesTypedName(jorren, "jorren vask"), true);
  assert.equal(matchesTypedName(jorren, '  Sir  Jorren  "the Blind"  Vask '), true);
  // A first name alone is no longer enough, which is the point.
  assert.equal(matchesTypedName(jorren, "Jorren"), false);
  assert.equal(matchesTypedName(jorren, ""), false);
  // The other Jorren is a different man.
  const other = { name: "Jorren Aldwych", firstName: "Jorren", lastName: "Aldwych" };
  assert.equal(matchesTypedName(other, "jorren vask"), false);
});

// ---- Who a warrant catches -------------------------------------------------
// warrantTargets is the whole of the rule and it is pure, so it is held down
// here rather than behind a database. The case that matters is two living men
// answering to one name: the old code refused and sent the officer to a GM.

// `tags` carries the wanted tag if the man already has one — the shape
// cerberonActions.js selects.
const man = (id, first, last, wanted = false) => ({
  id,
  name: `${first} ${last}`,
  firstName: first,
  lastName: last,
  tags: wanted ? [{ id: `${id}-tag` }] : [],
});

const IVANOV_A = man("a", "Alexander", "Ivanov");
const IVANOV_B = man("b", "Alexander", "Ivanov");
const VASK = man("c", "Jorren", "Vask");

test("a name two living men answer to warrants both of them", () => {
  const out = warrantTargets([IVANOV_A, IVANOV_B, VASK], "Alexander Ivanov", { selfId: null });
  assert.equal(out.matched, 2);
  assert.deepEqual(
    out.targets.map((t) => t.id),
    ["a", "b"],
  );
  assert.equal(out.alreadyWanted, 0);
});

test("a namesake already wanted is skipped, and the other man is still caught", () => {
  const wantedB = man("b", "Alexander", "Ivanov", true);
  const out = warrantTargets([IVANOV_A, wantedB], "alexander ivanov", { selfId: null });
  assert.equal(out.matched, 2);
  assert.equal(out.alreadyWanted, 1);
  assert.deepEqual(
    out.targets.map((t) => t.id),
    ["a"],
  );
});

test("your own name does not stop a warrant on the man who shares it", () => {
  const out = warrantTargets([IVANOV_A, IVANOV_B], "Alexander Ivanov", { selfId: "a" });
  assert.equal(out.skippedSelf, 1);
  assert.deepEqual(
    out.targets.map((t) => t.id),
    ["b"],
  );
});

test("the only match being yourself leaves nothing to warrant", () => {
  const out = warrantTargets([IVANOV_A, VASK], "Alexander Ivanov", { selfId: "a" });
  assert.equal(out.matched, 1);
  assert.equal(out.skippedSelf, 1);
  assert.equal(out.targets.length, 0);
});

test("everybody answering to the name being wanted already leaves nothing", () => {
  const both = [man("a", "Alexander", "Ivanov", true), man("b", "Alexander", "Ivanov", true)];
  const out = warrantTargets(both, "Alexander Ivanov", { selfId: null });
  assert.equal(out.matched, 2);
  assert.equal(out.alreadyWanted, 2);
  assert.equal(out.targets.length, 0);
});

test("nobody by that name matches nothing at all", () => {
  const out = warrantTargets([IVANOV_A, VASK], "Someone Else", { selfId: null });
  assert.equal(out.matched, 0);
  assert.equal(out.targets.length, 0);
  // A first name alone is still not enough here either.
  assert.equal(warrantTargets([IVANOV_A], "Alexander", { selfId: null }).matched, 0);
});

// ---- Who a lifted warrant frees --------------------------------------------
// The mirror of the block above: same matching, the two sides swapped.

test("a name two wanted men answer to lifts both warrants", () => {
  const both = [man("a", "Alexander", "Ivanov", true), man("b", "Alexander", "Ivanov", true)];
  const out = unwarrantTargets([...both, VASK], "Alexander Ivanov", { selfId: null });
  assert.equal(out.matched, 2);
  assert.deepEqual(
    out.targets.map((t) => t.id),
    ["a", "b"],
  );
  assert.equal(out.notWanted, 0);
});

test("a namesake who is not wanted is left alone", () => {
  const wantedB = man("b", "Alexander", "Ivanov", true);
  const out = unwarrantTargets([IVANOV_A, wantedB], "alexander ivanov", { selfId: null });
  assert.equal(out.matched, 2);
  assert.equal(out.notWanted, 1);
  assert.deepEqual(
    out.targets.map((t) => t.id),
    ["b"],
  );
});

test("a badge is not a pardon for the man carrying it", () => {
  const meWanted = man("a", "Alexander", "Ivanov", true);
  const out = unwarrantTargets([meWanted], "Alexander Ivanov", { selfId: "a" });
  assert.equal(out.matched, 1);
  assert.equal(out.skippedSelf, 1);
  assert.equal(out.targets.length, 0);
});

test("nobody by that name lifts nothing", () => {
  const out = unwarrantTargets([IVANOV_A, VASK], "Someone Else", { selfId: null });
  assert.equal(out.matched, 0);
  assert.equal(out.targets.length, 0);
});
