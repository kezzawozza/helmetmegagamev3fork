// Quests, and the one thing about them that can quietly destroy a live game.
//
// WHAT A FAILURE HERE MEANS. A quest room is the only Room in the game that
// docs/zones.yaml does not master — a GM stages it at runtime, so its slug is
// in no YAML file. db/lib/syncZones/sync.js's pass-4 prune deletes every Room whose
// slug the YAML does not name, thread and row together. Without the
// `questId: null` guard on that query, the next `db:sync-zones` — or the next
// Restart Game, which calls the same function — silently deletes every live
// quest, and the first anyone hears of it is a player asking where the cave
// they were standing in went.
//
// The prune is a Prisma where-clause inside a 1500-line function, so it is
// checked at the source rather than by running the sync. That is the same
// trade discordMarkup.test.js makes, and for the same reason: the thing worth
// guarding is a line of code, not a computation.
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

  // Nobody, no key, no invitation, not named: shut.
  assert.equal(accessibleRooms([room], none, none, none).length, 0);
  // Named on the quest: open.
  assert.equal(accessibleRooms([room], none, none, new Set(["r1"])).length, 1);
  // Holding the key still works, with no allowlist passed at all — which is
  // what every caller that predates quests does.
  assert.equal(accessibleRooms([room], new Set(["iron-key"]), none).length, 1);
  // A guest row still works too.
  assert.equal(accessibleRooms([room], none, new Set(["r1"])).length, 1);
  // A public room is public whatever the gates say.
  assert.equal(accessibleRooms([{ id: "r2", kind: "PUBLIC", accessTagSlugs: [] }], none, none, none).length, 1);
});

test("the Interact button appears on a quest room and nowhere else", () => {
  const onQuest = roomAffordances({ id: "r1", slug: "quest-abc", questId: "abc" });
  const interact = onQuest.find((a) => a.id === "questInteract");
  assert.ok(interact, "a quest room's starter post must carry Interact");
  // The QUEST id, not the room id: the quest outlives the room it minted.
  assert.equal(interact.customId, `${QUEST_INTERACT_PREFIX}abc`);
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
  // A quest that stands until somebody closes it has no number to show.
  assert.equal(turnsRemaining({ expiresTurn: null }, 10), null);
  assert.equal(turnsRemaining({ expiresTurn: 12 }, null), null);
});

test("the two fixed sentences say exactly what was asked for", () => {
  assert.equal(INTERACT_PROMPT, "Interacting will be a Gambit. Declare your intentions.");
  assert.equal(ALREADY_MOVED, "You've already used your move this turn.");
});

// db/lib/questText.js is imported by web/app/(app)/chat/PlacePanel.js, which is
// a "use client" component. One require of @lifeweb/db from that file drags
// PrismaClient into the browser bundle, which is the rule dmKinds.js and
// dmPolicy.js already carry — this is the same rule, enforced.
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
