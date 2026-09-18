// node --test over the medical-pass tag-shape validators in db/lib/tagShapes.js
// (cures, curesInto, administerSkill, resists — M1/M2, docs/systemdocs/
// TAGS.md §5c). Run with `npm test --workspace=db`. Nothing here touches
// Prisma; every validator is pure, taking its "does this slug/category exist"
// answer as a plain Set/Map rather than a live catalog — same posture as
// fear.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCures,
  validateCures,
  normalizeCuresInto,
  validateCuresInto,
  validateAdministerSkill,
  normalizeResists,
  validateResists,
  normalizeTurnsCost,
  validateHealableRequirement,
  normalizeExpiresInto,
  validateExpiresInto,
  normalizeRemovesInto,
  validateRemovesInto,
  normalizeRequirementItems,
  validateRequirementItems,
  normalizeRequirementYield,
  validateRequirementYield,
  normalizeMealTaste,
  validateMealTasteForm,
} = require("../lib/tagShapes");

const knownSlugs = new Set([
  "leeches",
  "bruised",
  "infected",
  "cleaning-powder",
  "medical-expert",
  "iron-constitution",
  "poisoned",
  "shell-shocked",
  "sword",
]);

const categoryBySlug = new Map([
  ["bruised", "Health"],
  ["infected", "Health"],
  ["shell-shocked", "Health"],
  ["poisoned", "Health"],
  ["leeches", "Items"],
  ["cleaning-powder", "Items"],
  ["medical-expert", "Skills"],
  ["sword", "Items"],
]);

test("normalizeCures accepts a list of slugs, dedupes, and rejects garbage shapes", () => {
  assert.equal(normalizeCures(null), null);
  assert.equal(normalizeCures([]), null);
  assert.deepEqual(normalizeCures(["bruised", "bruised", "infected"]), ["bruised", "infected"]);
  assert.throws(() => normalizeCures("bruised"), /cures must be a list/);
  assert.throws(() => normalizeCures([1]), /cures must be a list/);
  assert.throws(() => normalizeCures([""]), /cures must be a list/);
});

test("validateCures refuses an unknown cures target", () => {
  assert.throws(
    () =>
      validateCures(["nonexistent"], {
        selfSlug: "leeches",
        knownSlugs,
        categoryBySlug,
        consumable: true,
      }),
    /cures references unknown tag "nonexistent"/,
  );
});

test("validateCures refuses a cures target that isn't category Health", () => {
  assert.throws(
    () =>
      validateCures(["sword"], {
        selfSlug: "leeches",
        knownSlugs,
        categoryBySlug,
        consumable: true,
      }),
    /cures "sword", which isn't a Health tag/,
  );
});

test("validateCures refuses a non-consumable carrier", () => {
  assert.throws(
    () =>
      validateCures(["bruised"], {
        selfSlug: "leeches",
        knownSlugs,
        categoryBySlug,
        consumable: false,
      }),
    /declares cures but is not consumable/,
  );
});

test("validateCures passes a consumable curing a real Health tag — shell-shocked included, cures is deliberately not gated on healable", () => {
  assert.doesNotThrow(() =>
    validateCures(["bruised", "shell-shocked"], {
      selfSlug: "leeches",
      knownSlugs,
      categoryBySlug,
      consumable: true,
    }),
  );
  // null (no cures declared) is always a no-op, consumable or not.
  assert.doesNotThrow(() => validateCures(null, { selfSlug: "sword", knownSlugs, categoryBySlug, consumable: false }));
});

test("normalizeCuresInto accepts a cured-slug -> aftermath-slug mapping and rejects garbage shapes", () => {
  assert.equal(normalizeCuresInto(null), null);
  assert.equal(normalizeCuresInto({}), null);
  assert.deepEqual(normalizeCuresInto({ "missing-leg": "peg-leg" }), { "missing-leg": "peg-leg" });
  assert.throws(() => normalizeCuresInto(["missing-leg"]), /curesInto must be a mapping/);
  assert.throws(() => normalizeCuresInto({ "missing-leg": 1 }), /must map a cured slug to an aftermath slug/);
  assert.throws(() => normalizeCuresInto({ "": "peg-leg" }), /must map a cured slug to an aftermath slug/);
});

test("validateCuresInto refuses a key outside the tag's own cures list", () => {
  assert.throws(
    () =>
      validateCuresInto(
        { infected: "cleaning-powder" },
        { selfSlug: "leeches", knownSlugs, cures: ["bruised"] },
      ),
    /curesInto key "infected" isn't in its own cures list/,
  );
});

test("validateCuresInto refuses an unknown aftermath slug", () => {
  assert.throws(
    () =>
      validateCuresInto(
        { bruised: "nonexistent" },
        { selfSlug: "leeches", knownSlugs, cures: ["bruised"] },
      ),
    /curesInto references unknown tag "nonexistent"/,
  );
});

test("validateCuresInto passes a key that IS in cures, mapping to a real tag", () => {
  assert.doesNotThrow(() =>
    validateCuresInto(
      { bruised: "cleaning-powder" },
      { selfSlug: "leeches", knownSlugs, cures: ["bruised"] },
    ),
  );
});

test("validateAdministerSkill: null is a no-op, a known slug passes, an unknown slug or a non-string is refused", () => {
  assert.doesNotThrow(() => validateAdministerSkill(null, { knownSlugs, selfSlug: "wooden-leg" }));
  assert.doesNotThrow(() => validateAdministerSkill("medical-expert", { knownSlugs, selfSlug: "wooden-leg" }));
  assert.throws(
    () => validateAdministerSkill("nonexistent", { knownSlugs, selfSlug: "wooden-leg" }),
    /administerSkill references unknown tag "nonexistent"/,
  );
  assert.throws(
    () => validateAdministerSkill(3, { knownSlugs, selfSlug: "wooden-leg" }),
    /administerSkill must be a single tag slug/,
  );
  assert.throws(
    () => validateAdministerSkill("", { knownSlugs, selfSlug: "wooden-leg" }),
    /administerSkill must be a single tag slug/,
  );
});

test("normalizeResists accepts a list of slugs, dedupes, and rejects garbage shapes", () => {
  assert.equal(normalizeResists(null), null);
  assert.equal(normalizeResists([]), null);
  assert.deepEqual(normalizeResists(["poisoned", "poisoned"]), ["poisoned"]);
  assert.throws(() => normalizeResists("poisoned"), /resists must be a list/);
  assert.throws(() => normalizeResists([1]), /resists must be a list/);
});

test("validateResists refuses an unknown slug and passes a known one or null", () => {
  assert.throws(
    () => validateResists(["nonexistent"], { selfSlug: "iron-constitution", knownSlugs }),
    /resists references unknown tag "nonexistent"/,
  );
  assert.doesNotThrow(() => validateResists(["poisoned"], { selfSlug: "iron-constitution", knownSlugs }));
  assert.doesNotThrow(() => validateResists(null, { selfSlug: "iron-constitution", knownSlugs }));
});

// normalizeTurnsCost (M2, the arithmetic the whole Move economy rests on):
// a whole-number turnsCost, the "1/N" fraction encoding (requirementTurns 1
// + requirementPerTurn N), the perTurn/0-turn-ration pairing rule, and the
// healable-must-author-one guard added in the round-3 review.
test("normalizeTurnsCost accepts a whole-number turnsCost, and null when unset", () => {
  assert.deepEqual(normalizeTurnsCost({ turnsCost: 0 }, { slug: "infected" }), {
    requirementTurns: 0,
    requirementPerTurn: null,
  });
  assert.deepEqual(normalizeTurnsCost({ turnsCost: 1 }, { slug: "sepsis" }), {
    requirementTurns: 1,
    requirementPerTurn: null,
  });
  assert.deepEqual(normalizeTurnsCost({ turnsCost: 3 }, { slug: "phrygian-tears" }), {
    requirementTurns: 3,
    requirementPerTurn: null,
  });
  assert.deepEqual(normalizeTurnsCost({}, { slug: "sword" }), {
    requirementTurns: null,
    requirementPerTurn: null,
  });
  assert.deepEqual(normalizeTurnsCost(null, { slug: "sword" }), {
    requirementTurns: null,
    requirementPerTurn: null,
  });
});

// A part-turn cost is the number itself now; nothing is folded into
// requirementPerTurn, which is a ration again and nothing else.
test("normalizeTurnsCost takes a decimal number of Moves and leaves perTurn alone", () => {
  for (const turnsCost of [0.05, 0.1, 0.125, 0.2, 0.25, 0.5, 0.75, 1, 2, 6]) {
    assert.deepEqual(normalizeTurnsCost({ turnsCost }, { slug: "x" }), {
      requirementTurns: turnsCost,
      requirementPerTurn: null,
    });
  }
});

// Exactness is not fussiness: the Move budget is exact rational arithmetic
// (web/lib/craftBudget.js), and a cost it cannot hold exactly would let a
// character do work they never paid for. 0.1/0.125/0.2 are legal now
// (Cooking's finer shares, COOKING.md) — 0.33/0.3 stay refused because
// nothing on the grid can hold them exactly.
test("normalizeTurnsCost refuses a cost that is not on the exact grid", () => {
  for (const turnsCost of [0.33, 0.3, -0.25, -1]) {
    assert.throws(
      () => normalizeTurnsCost({ turnsCost }, { slug: "x" }),
      /turnsCost must be an exact number of Moves/,
      `expected ${turnsCost} to be refused`,
    );
  }
});

// Past one Move a recipe is a project, and a project takes whole turns.
test("normalizeTurnsCost refuses a fractional project", () => {
  assert.throws(() => normalizeTurnsCost({ turnsCost: 1.5 }, { slug: "x" }), /a project and takes whole turns/);
  assert.throws(() => normalizeTurnsCost({ turnsCost: 2.25 }, { slug: "x" }), /a project and takes whole turns/);
});

// Every one of these was a real authored value before 9/2026, so the refusal
// names the replacement rather than just saying no.
test("normalizeTurnsCost refuses the old 1/N fraction, and says what to write instead", () => {
  for (const turnsCost of ["1/3", "1/2", "1/4", " 1/4 ", "1/8"]) {
    assert.throws(
      () => normalizeTurnsCost({ turnsCost }, { slug: "x" }),
      /is a fraction .* those are gone; write it as a decimal/,
      `expected ${turnsCost} to be refused`,
    );
  }
  // Any other string is refused by the same door.
  assert.throws(() => normalizeTurnsCost({ turnsCost: "half" }, { slug: "x" }), /is a fraction/);
});

test("normalizeTurnsCost's perTurn is a 0-turn ration only — pairing it with a Move cost is refused", () => {
  assert.deepEqual(normalizeTurnsCost({ turnsCost: 0, perTurn: 4 }, { slug: "x" }), {
    requirementTurns: 0,
    requirementPerTurn: 4,
  });
  assert.throws(
    () => normalizeTurnsCost({ turnsCost: 1, perTurn: 3 }, { slug: "x" }),
    /sets perTurn on a recipe that costs a Move/,
  );
  assert.throws(
    () => normalizeTurnsCost({ perTurn: 0 }, { slug: "x" }),
    /requirement.perTurn must be a positive integer/,
  );
});

test("normalizeTurnsCost refuses a healable tag with no turnsCost at all, and passes one authored explicitly", () => {
  assert.throws(
    () => normalizeTurnsCost({}, { slug: "new-wound", healable: true }),
    /"new-wound" is healable but requirement\.turnsCost is missing/,
  );
  assert.throws(
    () => normalizeTurnsCost(null, { slug: "new-wound", healable: true }),
    /is healable but requirement\.turnsCost is missing/,
  );
  // A non-healable tag with no turnsCost is unaffected — that's the ordinary
  // "no Move cost at all" case most of the catalog uses.
  assert.doesNotThrow(() => normalizeTurnsCost({}, { slug: "sword", healable: false }));
  assert.doesNotThrow(() => normalizeTurnsCost({}, { slug: "sword" }));
  // Explicit 0 satisfies the guard just as well as a real cost.
  assert.doesNotThrow(() => normalizeTurnsCost({ turnsCost: 0 }, { slug: "new-wound", healable: true }));
  assert.doesNotThrow(() => normalizeTurnsCost({ turnsCost: 0.25 }, { slug: "new-wound", healable: true }));
});

test("validateHealableRequirement mirrors normalizeTurnsCost's guard for the GM form's already-parsed requirementTurns", () => {
  assert.throws(
    () => validateHealableRequirement(null, { healable: true, selfSlug: "custom-wound" }),
    /"custom-wound" is healable but requirementTurns is blank/,
  );
  assert.doesNotThrow(() => validateHealableRequirement(0, { healable: true, selfSlug: "custom-wound" }));
  assert.doesNotThrow(() => validateHealableRequirement(2, { healable: true, selfSlug: "custom-wound" }));
  assert.doesNotThrow(() => validateHealableRequirement(null, { healable: false, selfSlug: "custom-sword" }));
});

// The reserved `dead` token (TAGS.md §5c). It is not a catalog slug, so the
// only thing standing between "this wound kills at its own close" and a typo
// is this validator.
const expiryCtx = { selfSlug: "arterial-bleed", knownSlugs, durationTurns: 1, label: "test" };

test("validateExpiresInto accepts the reserved dead token on its own", () => {
  assert.doesNotThrow(() => validateExpiresInto(normalizeExpiresInto(["dead"]), expiryCtx));
});

test("validateExpiresInto accepts dead as one side of a coin flip", () => {
  assert.doesNotThrow(() =>
    validateExpiresInto(normalizeExpiresInto([{ oneOf: ["dead", "bruised"] }]), expiryCtx),
  );
});

test("validateExpiresInto refuses dead riding alongside another entry — nobody is left to hold it", () => {
  assert.throws(
    () => validateExpiresInto(normalizeExpiresInto(["dead", "bruised"]), expiryCtx),
    /beside another entry/,
  );
});

test("validateExpiresInto still refuses a genuinely unknown slug", () => {
  assert.throws(
    () => validateExpiresInto(normalizeExpiresInto(["deceased"]), expiryCtx),
    /unknown tag "deceased"/,
  );
});

// A tag may now name itself (TAGS.md §5c): db/lib/tagExpiryPass.js renews the
// row in place instead of granting a duplicate, so Sepsis/Punctured Lung/etc
// can expire into [dying, <own-slug>] and still owe their own cure after
// Dying is treated.
test("validateExpiresInto accepts a tag naming itself, alongside another entry", () => {
  assert.doesNotThrow(() =>
    validateExpiresInto(normalizeExpiresInto(["infected", "bruised"]), {
      selfSlug: "bruised",
      knownSlugs,
      durationTurns: 1,
      label: "test",
    }),
  );
});

test("validateExpiresInto accepts a tag naming only itself", () => {
  assert.doesNotThrow(() =>
    validateExpiresInto(normalizeExpiresInto(["bruised"]), {
      selfSlug: "bruised",
      knownSlugs,
      durationTurns: 1,
      label: "test",
    }),
  );
});

test("validateRemovesInto refuses dead — curing a wound must never be able to kill", () => {
  assert.throws(
    () =>
      validateRemovesInto(normalizeRemovesInto(["dead"]), {
        selfSlug: "arterial-bleed",
        knownSlugs,
        label: "test",
      }),
    /unknown tag "dead"/,
  );
});

// Cooking's multi-ingredient recipes (Vegetable Stew, Fried Fish, Sweets —
// COOKING.md §A4) need more than one anyOf picker per recipe, each answered
// independently by pickerIndex.
test("normalizeRequirementItems stamps each anyOf with a 0-based pickerIndex, counted only across anyOf entries", () => {
  const items = normalizeRequirementItems([
    "sword",
    { anyOf: ["leeches", "cleaning-powder"] },
    { anyOf: ["bruised", "infected"] },
  ]);
  assert.equal(items[0].kind, "tag");
  assert.equal(items[1].pickerIndex, 0);
  assert.equal(items[2].pickerIndex, 1);
});

test("validateRequirementItems accepts several anyOf pickers, including two with identical slugs", () => {
  const items = normalizeRequirementItems([
    { anyOf: ["leeches", "cleaning-powder"] },
    { anyOf: ["leeches", "cleaning-powder"] },
  ]);
  assert.doesNotThrow(() =>
    validateRequirementItems(items, {
      selfSlug: "fried-fish",
      tagSlugs: knownSlugs,
      groupSlugs: new Set(),
      craftable: true,
    }),
  );
});

test("validateRequirementItems still refuses a genuine non-anyOf duplicate", () => {
  const items = normalizeRequirementItems(["sword", "sword"]);
  assert.throws(
    () =>
      validateRequirementItems(items, {
        selfSlug: "x",
        tagSlugs: knownSlugs,
        groupSlugs: new Set(),
        craftable: true,
      }),
    /lists requirement item "sword" twice/,
  );
});

// requirement.yield — "Quantity Produced" (COOKING.md §A5).
test("normalizeRequirementYield: null stays null, a positive integer passes, anything else is refused", () => {
  assert.equal(normalizeRequirementYield(null, { slug: "x" }), null);
  assert.equal(normalizeRequirementYield(3, { slug: "x" }), 3);
  assert.throws(() => normalizeRequirementYield(0, { slug: "x" }), /whole number of 1 or more/);
  assert.throws(() => normalizeRequirementYield(1.5, { slug: "x" }), /whole number of 1 or more/);
});

test("validateRequirementYield refuses a non-craftable, a placement, or a multi-turn project", () => {
  const base = { selfSlug: "x" };
  assert.doesNotThrow(() => validateRequirementYield(2, { ...base, craftable: true }));
  assert.throws(
    () => validateRequirementYield(2, { ...base, craftable: false }),
    /declares requirement.yield but is not craftable/,
  );
  assert.throws(
    () => validateRequirementYield(2, { ...base, craftable: true, placement: {} }),
    /declares requirement.yield and placement/,
  );
  assert.throws(
    () => validateRequirementYield(2, { ...base, craftable: true, turnsCost: 3 }),
    /a project makes exactly one unit/,
  );
});

// mealTaste/mealTasteForm — the eating-side twin of mealMood/mealHunger (COOKING.md §A1/§A6).
test("normalizeMealTaste: null stays null, an empty string is legal (undetectable), long tastes are refused", () => {
  assert.equal(normalizeMealTaste(null, { slug: "x" }), null);
  assert.equal(normalizeMealTaste("", { slug: "x" }), "");
  assert.equal(normalizeMealTaste("  bland  ", { slug: "x" }), "bland");
  assert.throws(() => normalizeMealTaste("x".repeat(41), { slug: "x" }), /keep it under 40/);
});

test("validateMealTasteForm refuses anything but adjective/omitted, and refuses a form with no taste to describe", () => {
  assert.doesNotThrow(() => validateMealTasteForm({ mealTaste: null, mealTasteForm: null }, { selfSlug: "x" }));
  assert.doesNotThrow(() =>
    validateMealTasteForm({ mealTaste: "acidic", mealTasteForm: "adjective" }, { selfSlug: "x" }),
  );
  assert.throws(
    () => validateMealTasteForm({ mealTaste: "acidic", mealTasteForm: "noun" }, { selfSlug: "x" }),
    /must be "adjective" or omitted/,
  );
  assert.throws(
    () => validateMealTasteForm({ mealTaste: null, mealTasteForm: "adjective" }, { selfSlug: "x" }),
    /has mealTasteForm but no mealTaste/,
  );
});

// Unlike expiresInto, removesInto still refuses a tag naming itself — this
// is a distinct rule ("removing it would grant it right back") and isn't
// part of the expiresInto self-loop fix above.
test("validateRemovesInto still refuses a tag naming itself", () => {
  assert.throws(
    () =>
      validateRemovesInto(normalizeRemovesInto(["bruised"]), {
        selfSlug: "bruised",
        knownSlugs,
        label: "test",
      }),
    /itself/,
  );
});
