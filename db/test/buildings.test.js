// The Brewery, the Rookery and the Makeshift Stage, and the placement keys
// they're the first users of. Everything here is a PURE function: the sync
// validators (a bad key is silently dropped — normalizePlacement whitelists
// by construction) and the two gates deciding where a thing may stand and
// how many birds are owed.
const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizePlacement, validatePlacement } = require("../lib/tagShapes");
const { canBuildHere, placementOf } = require("../lib/structures");
const {
  BASE_BIRD_SENDS_PER_DAY,
  ROOKERY_COOLDOWN_MS,
  birdAllowanceFrom,
  rookeryCooldown,
} = require("../lib/rookery");

// --- normalizePlacement: the new keys ------------------------------------

test("placement: the new keys survive normalisation", () => {
  const p = normalizePlacement({
    locations: ["old-cock-inn"],
    yields: { tag: "alcohol", room: "inn-cellar", quantity: 1 },
    birdSendsPerDay: 6,
    music: { mood: 8, needs: "boombox" },
  });
  assert.deepEqual(p.locations, ["old-cock-inn"]);
  assert.deepEqual(p.yields, { tag: "alcohol", room: "inn-cellar", quantity: 1, skill: null });
  assert.equal(p.birdSendsPerDay, 6);
  assert.deepEqual(p.music, { mood: 8, needs: "boombox" });
});

test("placement: absent new keys default to empty, never undefined", () => {
  const p = normalizePlacement({ fieldwork: true });
  assert.deepEqual(p.locations, []);
  assert.equal(p.yields, null);
  assert.equal(p.birdSendsPerDay, null);
  assert.equal(p.music, null);
});

test("placement: yields.quantity defaults to 1 and skill to nobody", () => {
  const p = normalizePlacement({ yields: { tag: "alcohol", room: "inn-cellar" } });
  assert.equal(p.yields.quantity, 1);
  assert.equal(p.yields.skill, null); // absent means it runs itself; only a named skill gates the pour
});

test("placement: yields.skill rides through and must name a real tag", () => {
  const p = normalizePlacement({
    yields: { tag: "alcohol", room: "inn-cellar", skill: "brewing-basic" },
  });
  assert.equal(p.yields.skill, "brewing-basic");
  assert.throws(
    () =>
      validatePlacement(
        normalizePlacement({ yields: { tag: "alcohol", room: "r", skill: "nope" } }),
        { slug: "brewery", tag: { craftable: true, requirement: { turnsCost: 1 } }, knownSlugs: new Set(["alcohol"]) },
      ),
    /yields\.skill references unknown tag "nope"/,
  );
});

test("placement: an unknown key is dropped rather than stored", () => {
  const p = normalizePlacement({ fieldwork: true, birdSendsPerDy: 6 });
  assert.equal("birdSendsPerDy" in p, false);
  assert.equal(p.birdSendsPerDay, null);
});

test("placement: the new keys refuse nonsense", () => {
  const bad = [
    [{ locations: "old-cock-inn" }, /locations must be a list/],
    [{ birdSendsPerDay: 0 }, /birdSendsPerDay must be a positive integer/],
    [{ birdSendsPerDay: 1.5 }, /birdSendsPerDay must be a positive integer/],
    [{ yields: { room: "inn-cellar" } }, /yields\.tag must be a tag slug/],
    [{ yields: { tag: "alcohol" } }, /yields\.room must be a room slug/],
    [{ yields: { tag: "a", room: "b", quantity: 0 } }, /quantity must be a positive integer/],
    [{ yields: { tag: "a", room: "b", skill: "  " } }, /yields\.skill must be a tag slug/],
    [{ music: { needs: "boombox" } }, /music\.mood must be a positive integer/],
    [{ music: { mood: -8, needs: "boombox" } }, /music\.mood must be a positive integer/],
    [{ music: { mood: 8 } }, /music\.needs must be a tag slug/],
  ];
  for (const [raw, re] of bad) {
    assert.throws(() => normalizePlacement(raw), re, JSON.stringify(raw));
  }
});

test("placement: yields.tag and music.needs must name real tags", () => {
  const tag = { craftable: true, requirement: { turnsCost: 1 } };
  const knownSlugs = new Set(["alcohol", "boombox"]);
  assert.throws(
    () =>
      validatePlacement(normalizePlacement({ yields: { tag: "nope", room: "r" } }), {
        slug: "x",
        tag,
        knownSlugs,
      }),
    /yields\.tag references unknown tag "nope"/,
  );
  assert.throws(
    () =>
      validatePlacement(normalizePlacement({ music: { mood: 8, needs: "nope" } }), {
        slug: "x",
        tag,
        knownSlugs,
      }),
    /music\.needs references unknown tag "nope"/,
  );
});

// --- canBuildHere: the site gate -----------------------------------------

const INN = { slug: "old-cock-inn", indoors: true, attributes: { haven: true }, zone: { kind: "SURFACE" } };
const SQUARE = { slug: "town-square", indoors: false, attributes: {}, zone: { kind: "SURFACE" } };
const CAVE = { slug: "cave-one", indoors: true, attributes: {}, zone: { kind: "CAVE_LEVEL" } };
const DEPOT = { slug: "depot", indoors: false, attributes: { noBuild: true }, zone: { kind: "SURFACE" } };

const BREWERY = { locations: ["old-cock-inn"] };
const ANYWHERE = {};

test("canBuildHere: a named site is the only place its type may stand", () => {
  assert.equal(canBuildHere(INN, BREWERY).ok, true);
  assert.equal(canBuildHere(SQUARE, BREWERY).ok, false);
  assert.match(canBuildHere(SQUARE, BREWERY).reason, /only be built in the inn/);
});

test("canBuildHere: a named site satisfies the indoors default", () => {
  assert.equal(canBuildHere(INN, BREWERY).ok, true);
  assert.equal(canBuildHere(INN, ANYWHERE).ok, false);
  assert.match(canBuildHere(INN, ANYWHERE).reason, /indoors/);
});

test("canBuildHere: a named site does NOT override caves or noBuild", () => {
  const underground = { ...BREWERY, locations: ["cave-one"] };
  assert.equal(canBuildHere(CAVE, underground).ok, false);
  assert.match(canBuildHere(CAVE, underground).reason, /down here/);
  const atDepot = { ...BREWERY, locations: ["depot"] };
  assert.equal(canBuildHere(DEPOT, atDepot).ok, false);
});

test("canBuildHere: no placement asks the ground question only", () => {
  assert.equal(canBuildHere(SQUARE).ok, true);
  assert.equal(canBuildHere(INN).ok, false);
  assert.equal(canBuildHere(null).ok, false);
});

test("placementOf: the read side agrees with the normaliser's defaults", () => {
  const p = placementOf({ placement: { fieldwork: true } });
  assert.deepEqual(p.locations, []);
  assert.equal(p.yields, null);
  assert.equal(p.birdSendsPerDay, null);
  assert.equal(p.music, null);
});

// --- the Rookery ---------------------------------------------------------

test("birdAllowance: nothing standing here is worth the base one a day", () => {
  assert.equal(birdAllowanceFrom([]), BASE_BIRD_SENDS_PER_DAY);
  assert.equal(birdAllowanceFrom(null), BASE_BIRD_SENDS_PER_DAY);
  assert.equal(birdAllowanceFrom([{ status: "COMPLETE", placement: {} }]), BASE_BIRD_SENDS_PER_DAY);
});

test("birdAllowance: a rookery raises it, and a wreck does not", () => {
  const rookery = (status) => ({ status, placement: { birdSendsPerDay: 6 } });
  assert.equal(birdAllowanceFrom([rookery("COMPLETE")]), 6);
  assert.equal(birdAllowanceFrom([rookery("DAMAGED")]), 6); // still full of birds
  assert.equal(birdAllowanceFrom([rookery("RUINED")]), BASE_BIRD_SENDS_PER_DAY);
  assert.equal(birdAllowanceFrom([rookery("UNDER_CONSTRUCTION")]), BASE_BIRD_SENDS_PER_DAY);
  assert.equal(birdAllowanceFrom([rookery("ABANDONED")]), BASE_BIRD_SENDS_PER_DAY);
});

test("birdAllowance: the biggest wins, they never sum", () => {
  const rows = [
    { status: "COMPLETE", placement: { birdSendsPerDay: 6 } },
    { status: "COMPLETE", placement: { birdSendsPerDay: 4 } },
  ];
  assert.equal(birdAllowanceFrom(rows), 6);
});

test("rookeryCooldown: never sent is always ready", () => {
  assert.deepEqual(rookeryCooldown(null), { ok: true, secondsLeft: 0, readyAt: null });
});

test("rookeryCooldown: three minutes, and it reports a unix second to render", () => {
  const now = Date.UTC(2026, 8, 10, 12, 0, 0);
  const justNow = rookeryCooldown(new Date(now), now);
  assert.equal(justNow.ok, false);
  assert.equal(justNow.secondsLeft, ROOKERY_COOLDOWN_MS / 1000);
  assert.equal(justNow.readyAt, Math.ceil((now + ROOKERY_COOLDOWN_MS) / 1000)); // unix SECOND for <t:…:R>

  assert.equal(rookeryCooldown(new Date(now - ROOKERY_COOLDOWN_MS), now).ok, true);
  assert.equal(rookeryCooldown(new Date(now - ROOKERY_COOLDOWN_MS + 1), now).ok, false); // boundary belongs to ready
});
