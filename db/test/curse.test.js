// db/lib/curse.js decides who may only come back as a Migrant or a Bum, at
// six fewer points. A wrong answer here is a player handed a free
// unrestricted re-roll. Pure over rows, so no database and no stub.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isCursedIn, cursedUserIds, isPlayerCursed, CURSE_SELECT } = require("../lib/curse");

const BURIED = new Date("2026-09-08T12:00:00Z");

let clock = 0; // rows come back from Prisma in no guaranteed order; stamps an increasing createdAt
const row = (status, { buriedAt = null, cursedOverride = null, user = "u", at = null } = {}) => ({
  discordUserId: user,
  status,
  buriedAt,
  cursedOverride,
  createdAt: at ?? new Date(2026, 0, 1, 0, 0, (clock += 1)),
});

test("a living character is never cursed", () => {
  assert.equal(isCursedIn([row("ALIVE")]), false);
});

test("a body nobody has buried curses its player", () => {
  assert.equal(isCursedIn([row("DEAD")]), true);
});

test("burying the body lifts it", () => {
  assert.equal(isCursedIn([row("DEAD", { buriedAt: BURIED })]), false);
});

test("rolling a new character ends it, buried or not", () => {
  assert.equal(isCursedIn([row("DEAD"), row("ALIVE")]), false);
});

test("only the most recent body counts", () => {
  const lost = row("DEAD");
  const buried = row("DEAD", { buriedAt: BURIED });
  assert.equal(isCursedIn([lost, buried]), false);
});

test("...and the most recent body still counts when it is the unburied one", () => {
  const buried = row("DEAD", { buriedAt: BURIED });
  const lost = row("DEAD");
  assert.equal(isCursedIn([buried, lost]), true);
});

test("row order in the array does not decide the answer", () => {
  const older = row("DEAD", { at: new Date("2026-01-01") });
  const newer = row("DEAD", { buriedAt: BURIED, at: new Date("2026-02-01") });
  assert.equal(isCursedIn([older, newer]), false);
  assert.equal(isCursedIn([newer, older]), false);
});

test("a GM override of false lifts a curse the rule would apply", () => {
  assert.equal(isCursedIn([row("DEAD", { cursedOverride: false })]), false);
});

test("a GM override of true curses a living player", () => {
  assert.equal(isCursedIn([row("ALIVE", { cursedOverride: true })]), true);
});

test("the most recently decided override wins", () => {
  const first = row("DEAD", { cursedOverride: true, at: new Date("2026-01-01") });
  const second = row("DEAD", { cursedOverride: false, at: new Date("2026-02-01") });
  assert.equal(isCursedIn([first, second]), false);
});

test("the dead CURSED enum value counts as not-ALIVE", () => {
  assert.equal(isCursedIn([row("CURSED")]), true);
});

test("a player with no characters at all is not cursed", () => {
  assert.equal(isCursedIn([]), false);
  assert.equal(isCursedIn(undefined), false);
});

test("a missing buriedAt reads as still lying there, not as buried", () => {
  assert.equal(isCursedIn([{ discordUserId: "u", status: "DEAD", createdAt: new Date() }]), true);
});

test("the bulk form separates players", () => {
  const rows = [
    row("DEAD", { user: "a" }),
    row("ALIVE", { user: "b" }),
    row("DEAD", { buriedAt: BURIED, user: "c" }),
  ];
  assert.deepEqual([...cursedUserIds(rows)], ["a"]);
});

test("the bulk form applies the latest-body rule per player, not globally", () => {
  const rows = [
    row("DEAD", { user: "a", at: new Date("2026-01-01") }),
    row("DEAD", { user: "a", buriedAt: BURIED, at: new Date("2026-02-01") }),
    row("DEAD", { user: "b", buriedAt: BURIED, at: new Date("2026-01-01") }),
    row("DEAD", { user: "b", at: new Date("2026-02-01") }),
  ];
  assert.deepEqual([...cursedUserIds(rows)], ["b"]);
});

test("rows with no discordUserId are skipped, not counted", () => {
  assert.equal(cursedUserIds([row("DEAD", { user: null })]).size, 0);
  assert.equal(cursedUserIds(undefined).size, 0);
});

test("the query wrapper asks for every field the rule reads", async () => {
  let asked = null;
  const prisma = { character: { findMany: async (args) => ((asked = args), [row("DEAD")]) } };
  assert.equal(await isPlayerCursed(prisma, "u"), true);
  assert.deepEqual(asked.select, CURSE_SELECT);
  assert.deepEqual(Object.keys(CURSE_SELECT).sort(), [
    "buriedAt",
    "createdAt",
    "cursedOverride",
    "discordUserId",
    "status",
  ]);
});

test("the query wrapper asks the database nothing without a user id", async () => {
  let called = false;
  const prisma = { character: { findMany: async () => ((called = true), []) } };
  assert.equal(await isPlayerCursed(prisma, null), false);
  assert.equal(called, false);
});
