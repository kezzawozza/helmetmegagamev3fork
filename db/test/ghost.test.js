// node --test over db/lib/ghost.js — the WATCHING seat's rule, which is not the
// curse's (db/test/curse.test.js covers that one). Run with `npm test --workspace=db`.
// Nothing here touches Prisma: isGhostIn and ghostUserIds are pure.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isGhostIn, ghostUserIds, GHOST_SELECT } = require("../lib/ghost");
const { CURSE_SELECT } = require("../lib/curse");

test("a ghost is any DEAD body with no living character", () => {
  assert.equal(isGhostIn([{ status: "DEAD" }]), true);
  assert.equal(isGhostIn([{ status: "DEAD" }, { status: "DEAD" }]), true);
  assert.equal(isGhostIn([{ status: "ALIVE" }]), false);
  assert.equal(isGhostIn([]), false);
  assert.equal(isGhostIn(undefined), false);
});

test("a living character ends the seat, whichever order the rows arrive in", () => {
  assert.equal(isGhostIn([{ status: "DEAD" }, { status: "ALIVE" }]), false);
  assert.equal(isGhostIn([{ status: "ALIVE" }, { status: "DEAD" }]), false);
});

// The whole point of the split: burial lifts the re-roll penalty and says nothing
// about who may watch. The rule reads no `buriedAt` at all, so a buried body and an
// unburied one are the same answer here.
test("burial does not end the seat", () => {
  assert.equal(isGhostIn([{ status: "DEAD", buriedAt: new Date() }]), true);
  assert.equal(isGhostIn([{ status: "DEAD", buriedAt: null }]), true);
});

// Nothing writes CURSED, but curse.js counts it as a body (db/test/curse.test.js) and so must this.
test("the vestigial CURSED status counts as a body, as it does for the curse", () => {
  assert.equal(isGhostIn([{ status: "CURSED" }]), true);
});

// THE TRAP the module header warns about: a caller who narrows their query to DEAD rows
// hides the ALIVE one, and the rule then seats a living player in the dead room. The rule
// cannot defend itself against this — the test exists to name it.
test("rows pre-filtered to DEAD answer wrong, which is why callers must not filter", () => {
  const roster = [{ status: "DEAD" }, { status: "ALIVE" }];
  assert.equal(isGhostIn(roster), false);
  assert.equal(isGhostIn(roster.filter((r) => r.status === "DEAD")), true);
});

test("ghostUserIds groups by player and answers each one separately", () => {
  const rows = [
    { discordUserId: "dead-once", status: "DEAD" },
    { discordUserId: "re-rolled", status: "DEAD" },
    { discordUserId: "re-rolled", status: "ALIVE" },
    { discordUserId: "never-died", status: "ALIVE" },
    { discordUserId: "dead-twice", status: "DEAD" },
    { discordUserId: "dead-twice", status: "DEAD" },
  ];
  assert.deepEqual([...ghostUserIds(rows)].sort(), ["dead-once", "dead-twice"]);
  assert.deepEqual([...ghostUserIds([])], []);
  assert.deepEqual([...ghostUserIds([{ status: "DEAD" }])], []); // no discordUserId, no seat
});

// Stated in the header and relied on by the channel doctor, which loads one set of rows
// and asks both questions of it.
test("CURSE_SELECT is a superset of GHOST_SELECT, so cursed rows can answer this too", () => {
  for (const field of Object.keys(GHOST_SELECT)) {
    assert.equal(CURSE_SELECT[field], true, `CURSE_SELECT is missing ${field}`);
  }
});
