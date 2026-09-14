// A quest room is the only Room docs/zones.yaml does not master — a GM
// stages it at runtime, so its slug is in no YAML file.
// db/lib/syncZones/sync.js's pass-4 prune deletes every Room whose slug the
// YAML does not name; without the `questId: null` guard, the next
// db:sync-zones silently deletes every live quest. Checked at the source
// (a Prisma where-clause), same trade discordMarkup.test.js makes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { accessibleRooms } = require("../lib/roomAccess");
const { questRoomKind, turnsRemaining, ALREADY_MOVED, INTERACT_PROMPT } = require("../lib/quests");
const { roomAffordances, QUEST_INTERACT_PREFIX } = require("../lib/placeAffordances");
const questText = require("../lib/questText");

test("the zone sync's stale-room prune exempts quest rooms", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "syncZones", "sync.js"), "utf8");
  const match = source.match(/const staleRooms = await prisma\.room\.findMany\(\{[\s\S]*?\}\);/);
  assert.ok(match, "could not find the stale-room prune in syncZones/sync.js — has it been renamed?");
  assert.match(
    match[0],
    /questId:\s*null/,
    "the stale-room prune must carry `questId: null`, or a sync deletes every live quest",
  );
});

test("a quest room is only private when a gate is actually set", () => {
  assert.equal(questRoomKind({ accessTagSlugs: [], allowedCharacterIds: [] }), "PUBLIC");
  assert.equal(questRoomKind({ accessTagSlugs: ["iron-key"], allowedCharacterIds: [] }), "PRIVATE");
  assert.equal(questRoomKind({ accessTagSlugs: [], allowedCharacterIds: ["c1"] }), "PRIVATE");
});

test("the allowlist is a fourth door, and it does not disturb the other three", () => {
  const room = { id: "r1", kind: "PRIVATE", accessTagSlugs: ["iron-key"] };
  const none = new Set();

  assert.equal(accessibleRooms([room], none, none, none).length, 0);
  assert.equal(accessibleRooms([room], none, none, new Set(["r1"])).length, 1);
  assert.equal(accessibleRooms([room], new Set(["iron-key"]), none).length, 1);
  assert.equal(accessibleRooms([room], none, new Set(["r1"])).length, 1);
  assert.equal(accessibleRooms([{ id: "r2", kind: "PUBLIC", accessTagSlugs: [] }], none, none, none).length, 1);
});

test("the Interact button appears on a quest room and nowhere else", () => {
  const onQuest = roomAffordances({ id: "r1", slug: "quest-abc", questId: "abc" });
  const interact = onQuest.find((a) => a.id === "questInteract");
  assert.ok(interact, "a quest room's starter post must carry Interact");
  assert.equal(interact.customId, `${QUEST_INTERACT_PREFIX}abc`); // QUEST id, not room id
  assert.equal(onQuest[0].id, "questInteract", "Interact leads the row");

  const onPlain = roomAffordances({ id: "r2", slug: "kitchen" });
  assert.equal(
    onPlain.some((a) => a.id === "questInteract"),
    false,
  );
});

test("turns remaining counts the current turn, the way a notice does", () => {
  assert.equal(turnsRemaining({ expiresTurn: 12 }, 10), 3);
  assert.equal(turnsRemaining({ expiresTurn: 10 }, 10), 1);
  assert.equal(turnsRemaining({ expiresTurn: null }, 10), null);
  assert.equal(turnsRemaining({ expiresTurn: 12 }, null), null);
});

test("the two fixed sentences say exactly what was asked for", () => {
  assert.equal(INTERACT_PROMPT, "Interacting will be a Gambit. Declare your intentions.");
  assert.equal(ALREADY_MOVED, "You've already used your move this turn.");
});

// db/lib/questText.js is imported by a "use client" component; a require of
// @lifeweb/db there would drag PrismaClient into the browser bundle (same
// rule as dmKinds.js/dmPolicy.js).
test("questText.js has zero requires, so it stays client-safe", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "questText.js"), "utf8");
  assert.equal(
    /^\s*(const .*=\s*)?require\(/m.test(source),
    false,
    "db/lib/questText.js must require nothing — a client component imports it",
  );
});

test("there is exactly one spelling of the Interact custom_id", () => {
  assert.equal(QUEST_INTERACT_PREFIX, questText.QUEST_INTERACT_PREFIX);
});
