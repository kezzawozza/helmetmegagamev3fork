// db:import-zones — additive-only: create what's missing by slug, skip what's
// there, never touch it and never write a discord*Id. Dry run (apply: false,
// the default) so the fixture below only needs to answer reads.
const test = require("node:test");
const assert = require("node:assert/strict");

const { importZonesFromYaml } = require("../lib/importZones");

// One zone/location that already exists in the "database", one that doesn't.
const fixture = {
  zones: [
    {
      id: "town",
      name: "Town",
      locations: [{ id: "square", name: "The Square" }],
    },
    {
      id: "harbor",
      name: "Harbor",
      locations: [{ id: "docks", name: "The Docks" }],
    },
  ],
  connections: [["town/square", "harbor/docks"]],
};

function fakePrisma() {
  const existingZone = { id: "z-town", slug: "town", parentZoneId: null };
  const existingLocation = { id: "l-square", slug: "square", zoneId: "z-town" };
  return {
    zone: {
      findMany: async () => [existingZone],
      create: async () => { throw new Error("dry run must not write"); },
      update: async () => { throw new Error("dry run must not write"); },
    },
    location: {
      findMany: async () => [existingLocation],
      create: async () => { throw new Error("dry run must not write"); },
    },
    room: { findMany: async () => [] },
    locationLink: { findUnique: async () => null },
  };
}

test("additive import: one create, one skip, nothing else touched", async () => {
  const prisma = fakePrisma();
  const report = await importZonesFromYaml(prisma, { apply: false, doc: fixture });

  assert.deepEqual(report.created.zones, ["harbor"]);
  assert.deepEqual(report.created.locations, ["docks"]);
  assert.ok(report.skipped.some((line) => line === 'skipped zone "town" (exists)'));
  assert.ok(report.skipped.some((line) => line === 'skipped location "square" (exists)'));

  // Never an update, never a delete: the fake would have thrown if either
  // model's create/update had been called, and nothing here calls delete at
  // all — the importer has no such method to call.
  assert.equal(typeof prisma.zone.delete, "undefined");
  assert.equal(typeof prisma.location.delete, "undefined");
  assert.equal(typeof prisma.room.delete, "undefined");
});

test("no discord id is ever written", async () => {
  const prisma = fakePrisma();
  const report = await importZonesFromYaml(prisma, { apply: false, doc: fixture });
  const dump = JSON.stringify(report);
  assert.ok(!/discord[A-Za-z]*Id/.test(dump), "report must never carry a discord*Id");
});
