// node --test over db/lib/locationGraph.js#routesWithinZone / #pathWithinZone —
// the walk, and the four things it must never do: leave the zone, route through
// the fog, route through a way this character can't use, or pick a different
// road than the one a picker just showed (MAP.md §3c).
//
// No database. `prisma` is two findMany stubs returning literal rows, the way
// the rest of db/test/ fakes the one query a rule reads.
const test = require("node:test");
const assert = require("node:assert/strict");
const { routesWithinZone, pathWithinZone, NO_WALK } = require("../lib/locationGraph");

const TOWN = { id: "z-town", name: "Town", slug: "town", kind: "SURFACE", sortOrder: 1 };
const FOREST = { id: "z-forest", name: "Forest", slug: "forest", kind: "SURFACE", sortOrder: 2 };

function place(slug, zone = TOWN) {
  return { id: slug, slug, name: slug, description: null, sortOrder: 0, indoors: false, attributes: {}, zoneId: zone.id, zone };
}

// Every field crossingCheck and isHeldOpen read, defaulted to a plain open way.
function way(aId, bId, extra = {}) {
  return {
    id: `${aId}~${bId}`,
    aId,
    bId,
    hidden: false,
    requiredTagSlug: null,
    modular: false,
    isOpen: true,
    keyed: false,
    onFoot: false,
    openUntil: null,
    ...extra,
  };
}

function fakePrisma(locations, links) {
  return {
    locationLink: { findMany: async () => links },
    location: { findMany: async ({ where }) => locations.filter((l) => l.zoneId === where.zoneId && !l.retiredAt) },
    characterTag: { findMany: async () => [] },
  };
}

function walker(slugs = [], { at = "gate", zone = TOWN, held = null } = {}) {
  return {
    id: "c1",
    locationId: at,
    zoneId: zone.id,
    tags: slugs.map((slug) => ({ equipped: true, tag: { slug } })),
    heldUntil: held ? new Date(Date.now() + 60_000) : null,
    heldReason: held,
  };
}

// gate — square — market — keep, a straight road four places long.
const ROAD = {
  locations: ["gate", "square", "market", "keep"].map((s) => place(s)),
  links: [way("gate", "square"), way("market", "square"), way("keep", "market")],
};
const ALL_KNOWN = new Set(["gate", "square", "market", "keep"]);

test("a three-hop road is found, origin excluded and the target last", async () => {
  const prisma = fakePrisma(ROAD.locations, ROAD.links);
  const route = await pathWithinZone(prisma, walker(), "keep", { known: ALL_KNOWN });
  assert.equal(route.ok, true);
  assert.equal(route.hops, 3);
  assert.deepEqual(route.path.map((l) => l.slug), ["square", "market", "keep"]);
});

test("a shorter road through somewhere they have never seen is not taken", async () => {
  // gate -> alley -> keep is two hops, but the alley is not in the fog, so the
  // long way round is the walk — and the walk is still found, not refused.
  const locations = [...ROAD.locations, place("alley")];
  const links = [...ROAD.links, way("alley", "gate"), way("alley", "keep")];
  const prisma = fakePrisma(locations, links);

  const fogged = await pathWithinZone(prisma, walker(), "keep", { known: ALL_KNOWN });
  assert.equal(fogged.hops, 3);
  assert.deepEqual(fogged.path.map((l) => l.slug), ["square", "market", "keep"]);

  const learned = await pathWithinZone(prisma, walker(), "keep", { known: new Set([...ALL_KNOWN, "alley"]) });
  assert.equal(learned.hops, 2);
  assert.deepEqual(learned.path.map((l) => l.slug), ["alley", "keep"]);
});

test("a road out of the zone and back is never walked, even when it is shorter", async () => {
  // gate -> clearing (Forest) -> keep would be two hops. It must not be taken,
  // and it must not be taken SILENTLY either — the long way is what comes back.
  const locations = [...ROAD.locations, place("clearing", FOREST)];
  const links = [...ROAD.links, way("clearing", "gate"), way("clearing", "keep")];
  const prisma = fakePrisma(locations, links);

  const route = await pathWithinZone(prisma, walker(), "keep", {
    known: new Set([...ALL_KNOWN, "clearing"]),
  });
  assert.equal(route.hops, 3);
  assert.ok(!route.path.some((l) => l.zoneId === FOREST.id));

  // And the far side of the zone line is not a destination at all.
  const across = await pathWithinZone(prisma, walker(), "clearing", {
    known: new Set([...ALL_KNOWN, "clearing"]),
  });
  assert.deepEqual(across, { ok: false, reason: NO_WALK });
});

test("a locked way is not walked without its tag, and is with it", async () => {
  const links = [way("gate", "square"), way("market", "square", { requiredTagSlug: "keys" }), way("keep", "market")];
  const prisma = fakePrisma(ROAD.locations, links);

  assert.equal((await pathWithinZone(prisma, walker(), "keep", { known: ALL_KNOWN })).ok, false);
  assert.equal((await pathWithinZone(prisma, walker(["keys"]), "keep", { known: ALL_KNOWN })).hops, 3);
});

test("a hidden crawl refuses in the very same words a place with no road refuses in", async () => {
  // The §2a rule as a picture: if these two strings ever differ, the refusal
  // itself tells a player the crawl is there.
  const links = [way("gate", "square"), way("market", "square"), way("keep", "market", { hidden: true, requiredTagSlug: "caving" })];
  const prisma = fakePrisma([...ROAD.locations, place("nowhere")], links);

  const behindTheCrawl = await pathWithinZone(prisma, walker(), "keep", { known: ALL_KNOWN });
  const noRoadAtAll = await pathWithinZone(prisma, walker(), "nowhere", { known: new Set([...ALL_KNOWN, "nowhere"]) });
  assert.deepEqual(behindTheCrawl, noRoadAtAll);
  assert.equal(behindTheCrawl.reason, NO_WALK);

  // With the tag it is an ordinary way again.
  assert.equal((await pathWithinZone(prisma, walker(["caving"]), "keep", { known: ALL_KNOWN })).hops, 3);
});

test("a shut gate blocks; opening it unblocks; a propped keyed way lapses", async () => {
  const shut = [way("gate", "square"), way("market", "square", { modular: true, isOpen: false }), way("keep", "market")];
  assert.equal((await pathWithinZone(fakePrisma(ROAD.locations, shut), walker(), "keep", { known: ALL_KNOWN })).ok, false);

  const open = shut.map((l) => (l.modular ? { ...l, isOpen: true } : l));
  assert.equal((await pathWithinZone(fakePrisma(ROAD.locations, open), walker(), "keep", { known: ALL_KNOWN })).hops, 3);

  const hour = 60 * 60 * 1000;
  const propped = [
    way("gate", "square"),
    way("market", "square", { keyed: true, requiredTagSlug: "keys", openUntil: new Date(Date.now() + hour) }),
    way("keep", "market"),
  ];
  assert.equal((await pathWithinZone(fakePrisma(ROAD.locations, propped), walker(), "keep", { known: ALL_KNOWN })).hops, 3);

  const lapsed = propped.map((l) => (l.keyed ? { ...l, openUntil: new Date(Date.now() - hour) } : l));
  assert.equal((await pathWithinZone(fakePrisma(ROAD.locations, lapsed), walker(), "keep", { known: ALL_KNOWN })).ok, false);
});

test("two equally short roads always resolve to the same one, whatever order the rows arrive in", async () => {
  // gate -> north -> keep and gate -> south -> keep are both two hops. The
  // surface that SHOWS the route and the walk that takes it must agree, or
  // somebody is shot by a turret on a road they were never told they'd pass.
  const locations = [place("gate"), place("north"), place("south"), place("keep")];
  const links = [way("gate", "north"), way("gate", "south"), way("keep", "north"), way("keep", "south")];

  const roads = new Set();
  for (let i = 0; i < 12; i += 1) {
    const shuffled = [...links].sort(() => Math.random() - 0.5);
    const prisma = fakePrisma(locations, shuffled);
    const route = await pathWithinZone(prisma, walker(), "keep", {
      known: new Set(["gate", "north", "south", "keep"]),
    });
    roads.add(route.path.map((l) => l.slug).join(">"));
  }
  assert.deepEqual([...roads], ["north>keep"]);
});

test("a narrow way does not change the road, but says the arelitz is coming off", async () => {
  const links = [way("gate", "square"), way("market", "square", { onFoot: true }), way("keep", "market")];
  const prisma = fakePrisma(ROAD.locations, links);

  const walking = await pathWithinZone(prisma, walker(), "keep", { known: ALL_KNOWN });
  assert.equal(walking.dismounts, false);

  const riding = await pathWithinZone(prisma, walker(["arelitz"]), "keep", { known: ALL_KNOWN });
  assert.equal(riding.hops, 3, "the narrow way is still walked");
  assert.equal(riding.dismounts, true, "and it is said before they commit");
});

test("no road answers, rather than throwing, and an empty fog goes nowhere", async () => {
  const locations = [place("gate"), place("island")];
  const prisma = fakePrisma(locations, []);

  assert.deepEqual(await pathWithinZone(prisma, walker(), "island", { known: new Set(["gate", "island"]) }), {
    ok: false,
    reason: NO_WALK,
  });
  assert.deepEqual(await routesWithinZone(fakePrisma(ROAD.locations, ROAD.links), walker(), { known: new Set() }), []);
  // Standing still is not a walk.
  assert.equal((await pathWithinZone(fakePrisma(ROAD.locations, ROAD.links), walker(), "gate", { known: ALL_KNOWN })).ok, false);
});

test("a held character has no walk at all, even to a place an unheld one could reach", async () => {
  const prisma = fakePrisma(ROAD.locations, ROAD.links);
  // Same road, same fog, only the hold differs — so this isolates the hold as
  // the reason, not a missing edge or an unknown place (INTERCEPT.md §4).
  assert.deepEqual(await routesWithinZone(prisma, walker([], { held: "attack" }), { known: ALL_KNOWN }), []);
  assert.deepEqual(await pathWithinZone(prisma, walker([], { held: "attack" }), "keep", { known: ALL_KNOWN }), {
    ok: false,
    reason: NO_WALK,
  });
});

test("the neighbours are in the list too, nearest first", async () => {
  const routes = await routesWithinZone(fakePrisma(ROAD.locations, ROAD.links), walker(), { known: ALL_KNOWN });
  assert.deepEqual(
    routes.map((r) => [r.location.slug, r.hops]),
    [["square", 1], ["market", 2], ["keep", 3]],
  );
});
