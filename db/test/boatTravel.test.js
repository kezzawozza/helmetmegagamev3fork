// The Fishing Boat's free-move bonus (db/lib/locationTravel.js,
// db/lib/mounts.js) across the two water-zone pairs the world graph connects:
// Forest<->Hills and Hills<->Marshes (Marshes has no direct Forest link).
// Unlike a mount, a boat's bonus never depends on party size — it carries no
// passengers (db/lib/mounts.js#WATER_TRAVEL_SLUGS).
const test = require("node:test");
const assert = require("node:assert/strict");
const { freeZoneMoves, freeMovesLeft, freeZoneMovesReason } = require("../lib/locationTravel");
const { equippedSlugs, isBoated, boatCrossing } = require("../lib/mounts");

const FOREST = "forest";
const HILLS = "hills";
const MARSHES = "marshes";
const TOWN = "town"; // not a water zone, for the negative case

const boated = (tags = []) => ({ tags });
const withBoat = (equipped = true) => boated([{ equipped, tag: { slug: "fishing-boat" } }]);

test("boatCrossing: Forest<->Hills is a water crossing (forest-embankment <-> hills-shadowed-grove)", () => {
  assert.equal(boatCrossing(FOREST, HILLS), true);
  assert.equal(boatCrossing(HILLS, FOREST), true);
});

test("boatCrossing: Hills<->Marshes is a water crossing (the three plain links)", () => {
  assert.equal(boatCrossing(HILLS, MARSHES), true);
  assert.equal(boatCrossing(MARSHES, HILLS), true);
});

test("boatCrossing: Forest<->Marshes would qualify too, if a link ever connects them", () => {
  assert.equal(boatCrossing(FOREST, MARSHES), true);
});

test("boatCrossing: a zone outside the three never qualifies", () => {
  assert.equal(boatCrossing(FOREST, TOWN), false);
  assert.equal(boatCrossing(TOWN, HILLS), false);
});

test("freeZoneMoves: an equipped boat adds one crossing Forest<->Hills", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  const crossing = { fromZoneSlug: FOREST, toZoneSlug: HILLS };
  assert.equal(freeZoneMoves(withBoat(), config, crossing), 2);
});

test("freeZoneMoves: an equipped boat adds one crossing Hills<->Marshes", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  const crossing = { fromZoneSlug: HILLS, toZoneSlug: MARSHES };
  assert.equal(freeZoneMoves(withBoat(), config, crossing), 2);
});

test("freeZoneMoves: an UNEQUIPPED boat grants nothing — it only works held out", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  const crossing = { fromZoneSlug: FOREST, toZoneSlug: HILLS };
  assert.equal(freeZoneMoves(withBoat(false), config, crossing), 1);
});

test("freeZoneMoves: a boat is no help off the water, on either of these zones", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  assert.equal(freeZoneMoves(withBoat(), config, { fromZoneSlug: HILLS, toZoneSlug: TOWN }), 1);
});

test("freeZoneMoves: the boat's bonus does not depend on party size", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  const crossing = { fromZoneSlug: HILLS, toZoneSlug: MARSHES };
  assert.equal(freeZoneMoves(withBoat(), config, crossing, 0), 2);
  assert.equal(freeZoneMoves(withBoat(), config, crossing, 1), 2);
  assert.equal(freeZoneMoves(withBoat(), config, crossing, 5), 2);
});

test("freeMovesLeft: without a destination it reads used-up, but the real crossing still shows one free", () => {
  const config = { freeZoneMovesPerTurn: 1 };
  const openTurn = { id: "turn-1" };
  const character = { ...withBoat(), zoneMovesTurnId: "turn-1", zoneMovesUsed: 1 };

  assert.equal(freeMovesLeft(character, config, openTurn), 0); // AMBIENT read, no destination picked yet

  const crossing = { fromZoneSlug: HILLS, toZoneSlug: MARSHES };
  assert.equal(freeMovesLeft(character, config, openTurn, 0, crossing), 1);
});

test("freeZoneMovesReason: names the three zones and never mentions party size", () => {
  const reason = freeZoneMovesReason(withBoat());
  assert.match(reason, /Forest/);
  assert.match(reason, /Black Hills/);
  assert.match(reason, /Marshes/);
});

test("equippedSlugs: a HELD-but-not-equipped boat never counts as boated", () => {
  const held = [{ equipped: false, tag: { slug: "fishing-boat" } }];
  assert.equal(isBoated(equippedSlugs(held)), false);
});
