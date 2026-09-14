// A GM picks a SEAT; the game stores places under LEVELS. This is the fold
// between the two: Underground is a CAVE_GROUP with no Locations of its own,
// while Caves and Depths hold all thirteen cave Locations and are never in
// GmZoneView directly. If visibleZoneIds stops expanding the seat, a GM
// watching Underground silently loses the whole cave system. No database:
// visibleZoneIds takes its client as a parameter, so the stub below is the
// whole fixture. web/lib/zones.js#inVisibleZones is the twin on the NAME side.
const test = require("node:test");
const assert = require("node:assert/strict");
const { visibleZoneIds } = require("../lib/gmZoneView");

// Three surface zones seated on themselves, one CAVE_GROUP, two CAVE_LEVELs.
const ZONES = [
  { id: "z-town", slug: "town", seatZoneId: "z-town", parentZoneId: null },
  { id: "z-fortress", slug: "fortress", seatZoneId: "z-fortress", parentZoneId: null },
  { id: "z-marshes", slug: "marshes", seatZoneId: "z-marshes", parentZoneId: null },
  { id: "z-underground", slug: "underground", seatZoneId: "z-underground", parentZoneId: null },
  { id: "z-caves", slug: "caves", seatZoneId: "z-underground", parentZoneId: "z-underground" },
  { id: "z-depths", slug: "depths", seatZoneId: "z-underground", parentZoneId: "z-underground" },
];

function stub(views, zones = ZONES) {
  return {
    gmZoneView: {
      findMany: async () => views.map((zoneId) => ({ zoneId })),
    },
    zone: {
      findMany: async ({ where }) => {
        const [bySeat, byParent] = where.OR;
        const seats = new Set(bySeat.seatZoneId.in);
        const parents = new Set(byParent.parentZoneId.in);
        return zones
          .filter((z) => seats.has(z.seatZoneId) || parents.has(z.parentZoneId))
          .map((z) => ({ id: z.id }));
      },
    },
  };
}

test("no rows means every zone, and says so as null", async () => {
  assert.equal(await visibleZoneIds(stub([]), "gm-1"), null);
});

test("no user is every zone too — a signed-out reader gates elsewhere", async () => {
  assert.equal(await visibleZoneIds(null, null), null);
});

test("Underground hands over the cave levels with it", async () => {
  const visible = await visibleZoneIds(stub(["z-underground"]), "gm-1");
  assert.ok(visible.has("z-caves"), "Caves is missing — a GM watching Underground reads no cave places");
  assert.ok(visible.has("z-depths"), "Depths is missing");
  assert.ok(visible.has("z-underground"), "the seat itself should stay in the set");
  assert.equal(visible.size, 3);
});

test("a surface zone brings nothing else with it", async () => {
  const visible = await visibleZoneIds(stub(["z-town"]), "gm-1");
  assert.deepEqual([...visible].sort(), ["z-town"]);
});

test("two picks stay two answers, folded independently", async () => {
  const visible = await visibleZoneIds(stub(["z-town", "z-underground"]), "gm-1");
  assert.deepEqual([...visible].sort(), ["z-caves", "z-depths", "z-town", "z-underground"]);
  assert.ok(!visible.has("z-fortress"), "an unticked zone must not arrive by the fold");
});

test("a zone the sync has not backfilled behaves as it did before the fold", async () => {
  const zones = [...ZONES, { id: "z-new", slug: "new", seatZoneId: null, parentZoneId: null }];
  const visible = await visibleZoneIds(stub(["z-new"], zones), "gm-1");
  assert.deepEqual([...visible], ["z-new"]);
});

test("a level ticked directly does not drag its siblings in", async () => {
  const visible = await visibleZoneIds(stub(["z-caves"]), "gm-1");
  assert.deepEqual([...visible], ["z-caves"]);
});
