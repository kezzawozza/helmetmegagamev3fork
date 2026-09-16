// The pure halves of db/lib/lessons.js (docs/systemdocs/LESSONS.md §1): who
// teaches for free, and what the student has to roll. Everything else in that
// module needs Prisma, so it stays out of here.
const test = require("node:test");
const assert = require("node:assert");

const { teachesFree, lessonThreshold, lessonOutcome } = require("../lib/lessons");
const {
  TEACHING_SLUG,
  DRILL_INSTRUCTOR_SLUG,
  FIGHTING_GROUP_SLUG,
  UNTAUGHT_LESSON_THRESHOLD,
  LESSON_THRESHOLD,
  DRILL_THRESHOLD,
} = require("../lib/constants");

const who = (...slugs) => ({ tags: slugs.map((slug) => ({ tag: { slug } })) });
const fightingSkill = { group: { slug: FIGHTING_GROUP_SLUG } };
const ordinarySkill = { group: { slug: "skills-general" } };

test("teaching is free only for a Teaching holder", () => {
  assert.equal(teachesFree(who()), false);
  assert.equal(teachesFree(who("climbing")), false);
  assert.equal(teachesFree(who(TEACHING_SLUG)), true);
  assert.equal(teachesFree(who(TEACHING_SLUG, DRILL_INSTRUCTOR_SLUG)), true);
  // The retired Lecturing rung buys nothing any more.
  assert.equal(teachesFree(who("teaching-lecturing")), false);
});

test("an untrained teacher's student needs a 6", () => {
  assert.equal(lessonThreshold(who(), ordinarySkill), UNTAUGHT_LESSON_THRESHOLD);
  assert.equal(lessonThreshold(who(), fightingSkill), UNTAUGHT_LESSON_THRESHOLD);
});

test("Teaching drops the student to a 5", () => {
  assert.equal(lessonThreshold(who(TEACHING_SLUG), ordinarySkill), LESSON_THRESHOLD);
  assert.equal(lessonThreshold(who(TEACHING_SLUG), fightingSkill), LESSON_THRESHOLD);
});

test("Drill Instructor drops it to a 4, but only on a fighting skill", () => {
  const drill = who(TEACHING_SLUG, DRILL_INSTRUCTOR_SLUG);
  assert.equal(lessonThreshold(drill, fightingSkill), DRILL_THRESHOLD);
  assert.equal(lessonThreshold(drill, ordinarySkill), LESSON_THRESHOLD);
});

test("a missing skill never reads as a fighting skill", () => {
  assert.equal(
    lessonThreshold(who(TEACHING_SLUG, DRILL_INSTRUCTOR_SLUG), null),
    LESSON_THRESHOLD,
  );
});

// --- the outcome, now that a lesson resolves the moment it is accepted -------

test("the die has to reach the threshold", () => {
  assert.equal(lessonOutcome({ die: 4, threshold: 5, learnerStatus: "ALIVE" }).succeeded, false);
  assert.equal(lessonOutcome({ die: 5, threshold: 5, learnerStatus: "ALIVE" }).succeeded, true);
  assert.equal(lessonOutcome({ die: 6, threshold: 5, learnerStatus: "ALIVE" }).succeeded, true);
});

test("Hunger and mood move the total, and so does the Minted Charm", () => {
  // A 4 misses a 5 on its own, and makes it wearing the charm.
  assert.equal(lessonOutcome({ die: 4, threshold: 5, learnerStatus: "ALIVE" }).total, 4);
  assert.equal(
    lessonOutcome({ die: 4, charmBonus: 1, threshold: 5, learnerStatus: "ALIVE" }).succeeded,
    true,
  );
  // A Hungry learner can miss one they would otherwise have made.
  assert.equal(
    lessonOutcome({ die: 5, diceModifier: -1, threshold: 5, learnerStatus: "ALIVE" }).succeeded,
    false,
  );
});

test("a learner who died between the offer and the answer learns nothing", () => {
  // The roll is thrown at acceptance, so somebody can be killed in between.
  const { total, succeeded } = lessonOutcome({ die: 6, threshold: 4, learnerStatus: "DEAD" });
  assert.equal(total, 6, "the die still reads what it rolled");
  assert.equal(succeeded, false);
});
