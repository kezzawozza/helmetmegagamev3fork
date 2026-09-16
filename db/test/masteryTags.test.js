// The pure halves of the mastery tags (TAGS.md 4a): Amor Fati's sign-flipping
// mood multiplier, Second Wind's Health-penalty waiver, Manic's Desire-slot
// bypass. Lucky and Scavenging have their own file (advantage.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveDelta, multiplierFor, MULTIPLIER_SLUGS, EVENTS } = require("../lib/mood");
const { fightingSkillFor } = require("../lib/fightingSkill");
const { slotStates, desireSlotsNeverLock, evaluateDesireCatalog, manicScramblesTemplate } = require("../lib/desireGates");

const AMOR = ["amor-fati"];

// --- Amor Fati ------------------------------------------------------------
// "Unfortunate incidents only serve to make you pleased." A negative factor
// in the multiplier table, so harm comes back as relief.

test("a phobia cannot amplify the gift, and Brave cannot shrink it", () => {
  assert.equal(resolveDelta({ kind: "CAVE_TROUBLE", base: -10, heldSlugs: AMOR }), 5);
  assert.equal(resolveDelta({ kind: "CAVE_TROUBLE", base: -10, heldSlugs: [...AMOR, "teratophobia"] }), 5);
  assert.equal(resolveDelta({ kind: "WOUND", base: -30, heldSlugs: [...AMOR, "hemophobia"] }), 15);
  assert.equal(resolveDelta({ kind: "WOUND", base: -30, heldSlugs: [...AMOR, "brave"] }), 15);
  assert.equal(resolveDelta({ kind: "WILDERNESS", base: -10, heldSlugs: [...AMOR, "agoraphobia"] }), 0);
});

// ...and the multipliers still work for everybody who does NOT hold it.
test("the phobias and Brave are untouched without Amor Fati", () => {
  assert.equal(resolveDelta({ kind: "WOUND", base: -30, heldSlugs: ["brave"] }), -15);
  assert.equal(resolveDelta({ kind: "WOUND", base: -30, heldSlugs: ["hemophobia"] }), -60);
  assert.equal(resolveDelta({ kind: "CAVE_TROUBLE", base: -10, heldSlugs: ["teratophobia"] }), -30);
});

test("a shock pays back half its sting as mood instead of taking it", () => {
  assert.equal(resolveDelta({ kind: "CRUCIFIED", base: EVENTS.CRUCIFIED, heldSlugs: AMOR }), 40);
  assert.equal(resolveDelta({ kind: "TORTURED", base: EVENTS.TORTURED, heldSlugs: AMOR }), 20);
  assert.equal(resolveDelta({ kind: "MUTILATED", base: EVENTS.MUTILATED, heldSlugs: AMOR }), 25);
  assert.equal(resolveDelta({ kind: "WOUND", base: -30, heldSlugs: AMOR }), 15);
});

test("the ever-present miseries simply stop landing, and do not become a pleasure", () => {
  for (const kind of ["WILDERNESS", "CAVE", "HUNGER", "CORPSE", "NOBLE_MEAL"]) {
    const got = resolveDelta({ kind, base: -10, heldSlugs: AMOR });
    assert.equal(got, 0, `${kind} should be nothing at all, got ${got}`);
    assert.ok(Object.is(got, 0), `${kind} resolved to -0`); // not -0
  }
});

test("relief is untouched — Amor Fati is not a damper on good things", () => {
  assert.equal(resolveDelta({ kind: "KISS", base: EVENTS.KISS, heldSlugs: AMOR }), EVENTS.KISS);
  assert.equal(resolveDelta({ kind: "MUSIC", base: EVENTS.MUSIC, heldSlugs: AMOR }), EVENTS.MUSIC);
});

test("nobody else is changed by the new rows", () => {
  assert.equal(resolveDelta({ kind: "CRUCIFIED", base: EVENTS.CRUCIFIED, heldSlugs: [] }), -80);
  assert.equal(multiplierFor("WOUND", ["brave"]), 0.5);
  assert.equal(multiplierFor("WILDERNESS", ["outsider"]), 0);
});

// --- Imperturbable --------------------------------------------------------
// It works through `intensity` rather than a multiplier, because a multiplier
// is only consulted for harm and the tag has to stop the climb as well.

test("intensity zero stops the dial in BOTH directions", () => {
  assert.equal(resolveDelta({ kind: "WOUND", base: -30, heldSlugs: [], intensity: 0 }), 0);
  assert.equal(resolveDelta({ kind: "KISS", base: 15, heldSlugs: [], intensity: 0 }), 0);
});

test("Imperturbable is on the watched-slug list, or the nightly pass would miss it", () => {
  assert.ok(MULTIPLIER_SLUGS.includes("imperturbable"));
  assert.ok(MULTIPLIER_SLUGS.includes("amor-fati"));
  assert.equal(MULTIPLIER_SLUGS.length, new Set(MULTIPLIER_SLUGS).size, "no duplicate slugs");
});

// --- Second Wind ----------------------------------------------------------
const tag = (slug, category, fighting, group = null) =>
  ({ tag: { slug, name: slug, category, fighting, group: group ? { slug: group } : null } });
const SKILL = tag("melee-basic", "Skills", { tree: "melee", rung: 1 });
const SECOND_WIND = tag("second-wind", "General", null);
const WOUND = tag("broken-arm", "Health", { tree: "both", points: -15 }, "health-wounds");

test("a Health penalty outside the waived groups still costs you", () => {
  for (const [slug, group] of [["blind", "health-mind"], ["aching", "health-minor"]]) {
    const row = { tag: { slug, name: slug, category: "Health", group: { slug: group }, fighting: { tree: "both", points: -15 } } };
    const r = fightingSkillFor([SKILL, SECOND_WIND, row], "melee");
    assert.equal(r.contributors.find((c) => c.label === slug).points, -15, slug);
  }
});

// Illnesses are waived down to -1.5 tiers: milder is a cough you fight
// through, worse is killing you.
test("an ordinary illness is waived and a lethal one is not", () => {
  const illness = (slug, points) =>
    ({ tag: { slug, name: slug, category: "Health", group: { slug: "health-illness" }, fighting: { tree: "both", points } } });
  for (const [slug, points] of [["pox", -10], ["heatstroke", -15]]) {
    const r = fightingSkillFor([SKILL, SECOND_WIND, illness(slug, points)], "melee");
    assert.equal(r.contributors.find((c) => c.label === slug).points, 0, slug);
  }
  for (const [slug, points] of [["consumptive", -20], ["envenomated", -30]]) {
    const r = fightingSkillFor([SKILL, SECOND_WIND, illness(slug, points)], "melee");
    assert.equal(r.contributors.find((c) => c.label === slug).points, points, slug);
  }
});

test("all three wound groups are waived", () => {
  for (const group of ["health-wounds", "health-maiming", "health-infection"]) {
    const row = { tag: { slug: group, name: group, category: "Health", group: { slug: group }, fighting: { tree: "both", points: -15 } } };
    const r = fightingSkillFor([SKILL, SECOND_WIND, row], "melee");
    assert.equal(r.contributors.find((c) => c.label === group).points, 0, group);
  }
});

test("a missing group fails safe", () => {
  const row = { tag: { slug: "deep-wound", name: "deep-wound", category: "Health", fighting: { tree: "both", points: -15 } } };
  const r = fightingSkillFor([SKILL, SECOND_WIND, row], "melee");
  assert.equal(r.contributors.find((c) => c.label === "deep-wound").points, -15);
});

test("a Health penalty stops counting, but is still named at zero", () => {
  const without = fightingSkillFor([SKILL, WOUND], "melee");
  const with_ = fightingSkillFor([SKILL, WOUND, SECOND_WIND], "melee");
  assert.ok(with_.score > without.score, "the wound should stop costing anything");
  const row = with_.contributors.find((c) => c.label === "broken-arm");
  assert.ok(row, "the wound is still listed, so a player can read why it is free");
  assert.equal(row.points, 0);
  assert.equal(row.cancelledBy, "Second Wind");
});

test("a non-Health penalty is untouched", () => {
  const hangover = tag("hangover", "Status", { tree: "both", points: -10 });
  const with_ = fightingSkillFor([SKILL, hangover, SECOND_WIND], "melee");
  assert.equal(with_.contributors.find((c) => c.label === "hangover").points, -10);
});

test("the three Health tags that CAP the band still do", () => {
  for (const slug of ["dying", "paralyzed", "seizure"]) {
    const capped = fightingSkillFor(
      [SKILL, SECOND_WIND, tag(slug, "Health", { tree: "both", cap: "pitiful" })],
      "melee",
    );
    assert.equal(capped.band.key, "pitiful", `${slug} should still take you out of a fight`);
  }
});

test("a Health effect that HELPS keeps helping", () => {
  const boon = tag("adrenaline", "Health", { tree: "both", points: 10 });
  const with_ = fightingSkillFor([SKILL, boon, SECOND_WIND], "melee");
  assert.equal(with_.contributors.find((c) => c.label === "adrenaline").points, 10);
});

// --- Manic ----------------------------------------------------------------

test("Manic is recognised in every tag shape the app passes around", () => {
  assert.equal(desireSlotsNeverLock([{ tag: { slug: "manic" } }]), true);
  assert.equal(desireSlotsNeverLock([{ slug: "manic" }]), true);
  assert.equal(desireSlotsNeverLock(new Set(["manic"])), true);
  assert.equal(desireSlotsNeverLock([]), false);
});

test("a Manic slot reopens the instant it empties, where an ordinary one waits", () => {
  const history = [{ slotIndex: 0, endedTurnNumber: 5, status: "FULFILLED" }];
  const args = { history, openTurnNumber: 5, desireSlots: 1, lockTurns: 1 };
  assert.equal(slotStates(args)[0].lockedUntilTurn, 7);
  assert.equal(slotStates({ ...args, noLock: true })[0].lockedUntilTurn, null);
  assert.equal(slotStates({ ...args, noLock: true })[0].lockedTurnsLeft, null);
});

// The bug this guards: lockTurns 0 still reads `openTurnNumber <= maxEnded`,
// which is TRUE on the turn of the claim. Zero means "reopens tomorrow".
test("lockTurns 0 is NOT the same as no lock, which is why noLock exists", () => {
  const history = [{ slotIndex: 0, endedTurnNumber: 5, status: "FULFILLED" }];
  const args = { history, openTurnNumber: 5, desireSlots: 1 };
  assert.equal(slotStates({ ...args, lockTurns: 0 })[0].lockedUntilTurn, 6);
  assert.equal(slotStates({ ...args, lockTurns: 0, noLock: true })[0].lockedUntilTurn, null);
});

test("Manic still leaves the last claim readable in the slot", () => {
  const history = [{ slotIndex: 0, endedTurnNumber: 5, status: "FULFILLED", id: "d1" }];
  const slot = slotStates({ history, openTurnNumber: 5, desireSlots: 1, lockTurns: 1, noLock: true })[0];
  assert.equal(slot.lastEnded.id, "d1");
});

// --- Manic's random Desire lock (TAGS.md 4a) -------------------------------
// The trade for never waiting out a slot's own cooldown, above: ~70% of the
// catalog locks at random each turn, re-rolled every turn.

const MANIC_TAG = { id: "manic-tag-id", slug: "manic", name: "Manic" };

function stubTemplate(id, overrides = {}) {
  return {
    id,
    retired: false,
    tier: 1,
    families: [],
    requiresAnyTags: [],
    requiresAllTags: [],
    requiresNotTags: [],
    requiresAnyRoles: [],
    requiresNotRoles: [],
    requiresAnyOf: false,
    onceEver: false,
    cooldownTurns: null,
    ...overrides,
  };
}

test("Manic's random lock is deterministic for the same character, turn and template", () => {
  const a = manicScramblesTemplate("char-1", 5, "template-1");
  const b = manicScramblesTemplate("char-1", 5, "template-1");
  assert.equal(a, b);
});

test("Manic's locked set changes from turn to turn", () => {
  const templateIds = Array.from({ length: 50 }, (_, i) => `template-${i}`);
  const turn5 = templateIds.filter((id) => manicScramblesTemplate("char-1", 5, id)).sort();
  const turn6 = templateIds.filter((id) => manicScramblesTemplate("char-1", 6, id)).sort();
  assert.notDeepEqual(turn5, turn6);
});

test("Manic locks roughly 70% of the catalog, not all or none of it", () => {
  const templateIds = Array.from({ length: 2000 }, (_, i) => `template-${i}`);
  const lockedCount = templateIds.filter((id) => manicScramblesTemplate("char-1", 9, id)).length;
  const fraction = lockedCount / templateIds.length;
  assert.ok(fraction > 0.55 && fraction < 0.85, `expected roughly 70% locked, got ${fraction}`);
});

test("a non-Manic character is never touched by the random lock", () => {
  const templates = Array.from({ length: 20 }, (_, i) => stubTemplate(`t${i}`));
  const { visible } = evaluateDesireCatalog({
    templates,
    heldTags: [],
    hiddenTagIds: new Set(),
    roleSlug: null,
    history: [],
    openTurnNumber: 9,
    desireSlots: 2,
    characterId: "char-1",
  });
  assert.ok(visible.every((v) => v.state === "available"));
});

test("without a characterId, Manic's random lock is skipped entirely", () => {
  const templates = Array.from({ length: 20 }, (_, i) => stubTemplate(`t${i}`));
  const { visible } = evaluateDesireCatalog({
    templates,
    heldTags: [MANIC_TAG],
    hiddenTagIds: new Set(),
    roleSlug: null,
    history: [],
    openTurnNumber: 9,
    desireSlots: 2,
    // no characterId passed
  });
  assert.ok(visible.every((v) => v.state === "available"));
});

test("Manic's random lock never overrides an earlier gate (cooldown wins)", () => {
  const templates = [stubTemplate("cooldown-t", { cooldownTurns: 10 })];
  const history = [{ templateId: "cooldown-t", status: "FULFILLED", endedTurnNumber: 1 }];
  const { visible } = evaluateDesireCatalog({
    templates,
    heldTags: [MANIC_TAG],
    hiddenTagIds: new Set(),
    roleSlug: null,
    history,
    openTurnNumber: 2,
    desireSlots: 2,
    characterId: "char-1",
  });
  assert.equal(visible[0].state, "cooldown");
});

test("Manic can lock an otherwise-available template", () => {
  // Find an id the deterministic roll actually locks for this character+turn,
  // so the assertion below is never flaky.
  let lockedId = null;
  for (let i = 0; i < 200; i++) {
    if (manicScramblesTemplate("char-1", 9, `probe-${i}`)) {
      lockedId = `probe-${i}`;
      break;
    }
  }
  assert.ok(lockedId, "expected at least one locked id among 200 probes");

  const { visible } = evaluateDesireCatalog({
    templates: [stubTemplate(lockedId)],
    heldTags: [MANIC_TAG],
    hiddenTagIds: new Set(),
    roleSlug: null,
    history: [],
    openTurnNumber: 9,
    desireSlots: 2,
    characterId: "char-1",
  });
  assert.equal(visible[0].state, "locked");
  assert.match(visible[0].reason, /Manic/);
});

// --- Metempsychosis: who the new body turns out to be. reincarnate() itself
// needs Prisma; this pins the rolling, not the transaction around it. -------
const { randomCharacterName, NAME_CORPUS } = require("../lib/nameCorpus");
const { GENDERS } = require("../lib/titles");
const { isDynastyMember } = require("../lib/dynasty");
const { AGE_MIN, AGE_MAX } = require("../lib/characterName");
const { REINCARNATION_AGE_MAX } = require("../lib/reincarnate");

const namesIn = (...pools) => new Set(pools.flat().map((n) => n.name));
const MALE_OK = namesIn(NAME_CORPUS.medieval.male, NAME_CORPUS.flavour.male, NAME_CORPUS.flavour.witcher);
const FEMALE_OK = namesIn(NAME_CORPUS.medieval.female, NAME_CORPUS.flavour.female);

test("a rolled MAN draws only from the male pools, a WOMAN only from the female", () => {
  for (let i = 0; i < 300; i++) {
    assert.ok(MALE_OK.has(randomCharacterName({ gender: "MAN" }).firstName));
    assert.ok(FEMALE_OK.has(randomCharacterName({ gender: "WOMAN" }).firstName));
  }
});

test("NEUTRAL draws from both, so over many rolls it reaches each side", () => {
  let male = 0;
  let female = 0;
  for (let i = 0; i < 400; i++) {
    const { firstName } = randomCharacterName({ gender: "NEUTRAL" });
    if (MALE_OK.has(firstName)) male += 1;
    if (FEMALE_OK.has(firstName)) female += 1;
  }
  assert.ok(male > 0 && female > 0, `neutral reached only one pool (${male}/${female})`);
});

test("a dynasty seat gets no rolled surname", () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(randomCharacterName({ gender: "MAN", lastNameLocked: true }).lastName, null);
  }
  assert.ok(randomCharacterName({ gender: "MAN" }).lastName, "an ordinary seat still gets one");
});

test("isDynastyMember covers exactly the three seats that inherit the name", () => {
  for (const slug of ["baroness", "heir", "successor"]) assert.equal(isDynastyMember(slug), true, slug);
  for (const slug of ["baron", "migrant", "bum"]) assert.equal(isDynastyMember(slug), false, slug);
});

test("a rolled age spans 18-65 and reaches both ends", () => {
  const roll = () => AGE_MIN + Math.floor(Math.random() * (REINCARNATION_AGE_MAX - AGE_MIN + 1));
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 20000; i++) {
    const age = roll();
    assert.ok(Number.isInteger(age) && age >= AGE_MIN && age <= REINCARNATION_AGE_MAX, `out of range: ${age}`);
    lo = Math.min(lo, age);
    hi = Math.max(hi, age);
  }
  assert.equal(lo, AGE_MIN);
  assert.equal(hi, REINCARNATION_AGE_MAX);
});

test("the rolled band stops well below the catalog age ceiling", () => {
  assert.ok(REINCARNATION_AGE_MAX < AGE_MAX, "a roll must not reach the wizard's ceiling");
  assert.equal(REINCARNATION_AGE_MAX, 65);
});

test("GENDERS is the three-value set the roll picks from", () => {
  assert.deepEqual([...GENDERS].sort(), ["MAN", "NEUTRAL", "WOMAN"]);
});
