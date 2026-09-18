// node --test over the pure half of pushing on (db/lib/locationTravel.js,
// MAP.md §3): what the die costs, how "already pushed on this turn" is read
// off the crossing counters with no column of its own, and the refusal list
// the surfaces ask before drawing the button. Follows db/test/lamedTravel.test.js:
// plain { tags } objects, no Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const { exertOutcome, exertedThisTurn, exertRefusal, exertResultLine, exertEdgeFor, exertEdgeSentence } = require("../lib/locationTravel");

const NAMES = { "sprained-ankle": "Sprained Ankle", horse: "Horse", overburdened: "Overburdened", tired: "Tired", exhausted: "Exhausted", "punctured-lung": "Punctured Lung", "blind-drunk": "Blind Drunk" };
const withTags = (...slugs) => ({ tags: slugs.map((slug) => ({ equipped: true, tag: { slug, name: NAMES[slug] ?? slug } })) });
const turn = { id: "t1", number: 4 };
const config = { freeZoneMovesPerTurn: 1 };
const counters = (used, bonusUsed = 0, turnId = "t1") => ({ zoneMovesTurnId: turnId, zoneMovesUsed: used, zoneMovesBonusUsed: bonusUsed });

test("exertOutcome: 1 injures, 2–3 exhausts, 4–5 tires, 6 costs nothing", () => {
  assert.equal(exertOutcome(1), "injury");
  assert.equal(exertOutcome(2), "exhausted");
  assert.equal(exertOutcome(3), "exhausted");
  assert.equal(exertOutcome(4), "tired");
  assert.equal(exertOutcome(5), "tired");
  assert.equal(exertOutcome(6), "none");
});

test("exertedThisTurn: the base pool over the base allowance, and nothing else", () => {
  // Nothing spent, or a different turn's counters: no.
  assert.equal(exertedThisTurn({ ...withTags(), ...counters(0) }, config, turn), false);
  assert.equal(exertedThisTurn({ ...withTags(), ...counters(2, 0, "t0") }, config, turn), false);
  // The one free crossing spent: no. A paid crossing never touches the counter.
  assert.equal(exertedThisTurn({ ...withTags(), ...counters(1) }, config, turn), false);
  // One over the allowance: yes.
  assert.equal(exertedThisTurn({ ...withTags(), ...counters(2) }, config, turn), true);
  // A mount's crossing was charged to the bonus pool, then the land crossing
  // to the base: still no. Then a push on: yes.
  assert.equal(exertedThisTurn({ ...withTags("horse"), ...counters(2, 1) }, config, turn), false);
  assert.equal(exertedThisTurn({ ...withTags("horse"), ...counters(3, 1) }, config, turn), true);
  // No open turn: never.
  assert.equal(exertedThisTurn({ ...withTags(), ...counters(2) }, config, null), false);
});

test("exertRefusal: the reasons, in the order a player can read them off their sheet", () => {
  const spent = counters(1);
  assert.match(exertRefusal({ ...withTags("horse"), ...spent }, config, turn, { left: 0, acted: true }), /horse has ridden/);
  assert.match(exertRefusal({ ...withTags("sprained-ankle"), ...spent }, config, turn, { left: 0, acted: true }), /Sprained Ankle/);
  // Too hurt to march, though none of these restrict ACT.
  assert.match(exertRefusal({ ...withTags("punctured-lung"), ...spent }, config, turn, { left: 0, acted: true }), /Punctured Lung prevents you/);
  assert.match(exertRefusal({ ...withTags("blind-drunk"), ...spent }, config, turn, { left: 0, acted: true }), /Blind Drunk/);
  // Top of the ladder: nothing left to lose but the ankle, so no free gamble.
  assert.match(exertRefusal({ ...withTags("exhausted"), ...spent }, config, turn, { left: 0, acted: true }), /Exhausted/);
  assert.match(exertRefusal({ ...withTags("overburdened"), ...spent }, config, turn, { left: 0, acted: true }), /overburdened, drop some weight/);
  assert.match(exertRefusal({ ...withTags(), ...counters(0) }, config, turn, { left: 1, acted: true }), /still have a free crossing/);
  // The gamble is for going the distance: the Move has to be gone first.
  assert.match(exertRefusal({ ...withTags(), ...spent }, config, turn, { left: 0 }), /haven't spent your Move/);
  assert.match(exertRefusal({ ...withTags(), ...counters(2) }, config, turn, { left: 0, acted: true }), /already pushed on/);
  // Clear: on foot, free crossing spent, Move spent, not yet pushed on.
  assert.equal(exertRefusal({ ...withTags("tired"), ...spent }, config, turn, { left: 0, acted: true }), null);
});

test("exertResultLine: what it cost and the die that counted, nothing about the other die", () => {
  assert.equal(exertResultLine({ die: 6, rolls: [6], edge: null, names: [], effect: "none", tagName: "Winded" }), "You pushed on and have arrived only Winded. Rolled: **6**");
  assert.equal(exertResultLine({ die: 4, rolls: [4], edge: null, names: [], effect: "tired", tagName: "Tired" }), "You pushed on and are now Tired. Rolled: **4**");
  assert.equal(exertResultLine({ die: 5, rolls: [2, 5], edge: "better", names: ["Lucky"], effect: "tired", tagName: "Exhausted" }), "You pushed on and are now Exhausted. Rolled: **5**");
  assert.equal(exertResultLine({ die: 1, rolls: [1, 4], edge: "worse", names: ["Fat"], effect: "injury", tagName: "Sprained Ankle" }), "You pushed on and sprained your ankle. Rolled: **1**");
  assert.equal(exertResultLine(null), null);
});

test("exertEdgeSentence: names the deciders, and which way", () => {
  assert.equal(exertEdgeSentence({ edge: "better", names: ["Lucky"] }), "Due to Lucky you have advantage on this roll.");
  assert.equal(exertEdgeSentence({ edge: "better", names: ["Lucky", "Quick-Footed"] }), "Due to Lucky and Quick-Footed you have advantage on this roll.");
  assert.equal(exertEdgeSentence({ edge: "worse", names: ["Fat", "Old", "Lucky"] }), "Due to Fat, Old and Lucky you have disadvantage on this roll.");
  assert.equal(exertEdgeSentence({ edge: null, names: [] }), null);
  assert.deepEqual(exertEdgeFor([{ tag: { slug: "old", name: "Old" } }]), { edge: "worse", names: ["Old"] });
});
