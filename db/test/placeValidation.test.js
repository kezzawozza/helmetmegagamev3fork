// db/lib/placeValidation.js — the slug/name rules the /gm/dev/zones editor
// enforces before a Zone, Location or Room row is written. Run with
// `npm test --workspace=db`.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateSlugShape,
  validateNewSlug,
  validateName,
  validateUniqueName,
} = require("../lib/placeValidation");

// A stand-in with just enough of the three models' findUnique/findFirst to
// answer slug and name lookups. `rows` is { zone: [...], location: [...], room: [...] }.
function fakePrisma(rows = { zone: [], location: [], room: [] }) {
  const table = (name) => rows[name] ?? [];
  const model = (name) => ({
    findUnique: async ({ where }) => table(name).find((r) => r.slug === where.slug) ?? null,
    findFirst: async ({ where }) => {
      return (
        table(name).find((r) => {
          if (where.slug !== undefined && r.slug !== where.slug) return false;
          if (where.name !== undefined && r.name !== where.name) return false;
          if (where.locationId !== undefined && r.locationId !== where.locationId) return false;
          if (where.id?.not && r.id === where.id.not) return false;
          return true;
        }) ?? null
      );
    },
  });
  return { zone: model("zone"), location: model("location"), room: model("room") };
}

test("a slug must be lowercase letters, digits and hyphens starting with a letter", () => {
  assert.equal(validateSlugShape("town-square"), null);
  assert.notEqual(validateSlugShape("Town"), null);
  assert.notEqual(validateSlugShape("1town"), null);
  assert.notEqual(validateSlugShape("town square"), null);
  assert.notEqual(validateSlugShape(""), null);
});

test("a slug over 64 characters is refused", () => {
  assert.notEqual(validateSlugShape("a".repeat(65)), null);
  assert.equal(validateSlugShape("a".repeat(64)), null);
});

test("slugs share one namespace across zone, location and room", async () => {
  const prisma = fakePrisma({
    zone: [{ id: "z1", slug: "town" }],
    location: [{ id: "l1", slug: "cathedral" }],
    room: [{ id: "r1", slug: "nave" }],
  });
  assert.notEqual(await validateNewSlug(prisma, "town"), null);
  assert.notEqual(await validateNewSlug(prisma, "cathedral"), null);
  assert.notEqual(await validateNewSlug(prisma, "nave"), null);
  assert.equal(await validateNewSlug(prisma, "new-place"), null);
});

test("a name is required and bounded", () => {
  assert.notEqual(validateName(""), null);
  assert.notEqual(validateName("  "), null);
  assert.equal(validateName("The Cathedral"), null);
  assert.notEqual(validateName("x".repeat(101)), null);
});

test("zone and location names are unique globally", async () => {
  const prisma = fakePrisma({
    zone: [{ id: "z1", name: "Town" }],
    location: [{ id: "l1", name: "Cathedral" }],
    room: [],
  });
  assert.notEqual(await validateUniqueName(prisma, "zone", "Town"), null);
  assert.equal(await validateUniqueName(prisma, "zone", "Fortress"), null);
  assert.notEqual(await validateUniqueName(prisma, "location", "Cathedral"), null);
});

test("editing a row excludes itself from the uniqueness check", async () => {
  const prisma = fakePrisma({ zone: [{ id: "z1", name: "Town" }], location: [], room: [] });
  assert.equal(await validateUniqueName(prisma, "zone", "Town", { excludeId: "z1" }), null);
  assert.notEqual(await validateUniqueName(prisma, "zone", "Town", { excludeId: "z2" }), null);
});

test("room names are unique per location, not globally", async () => {
  const prisma = fakePrisma({
    zone: [],
    location: [],
    room: [
      { id: "r1", name: "Nave", locationId: "cathedral" },
      { id: "r2", name: "Nave", locationId: "keep" }, // pre-existing collision elsewhere is fine to have on disk
    ],
  });
  assert.notEqual(await validateUniqueName(prisma, "room", "Nave", { locationId: "cathedral" }), null);
  assert.equal(await validateUniqueName(prisma, "room", "Nave", { locationId: "undercroft" }), null);
});
