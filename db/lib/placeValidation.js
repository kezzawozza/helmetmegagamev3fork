// Validation shared by the GM place editor (/gm/dev/zones) for Zone,
// Location and Room rows. Pure functions over plain values plus a `prisma`
// handed in for the uniqueness lookups — no server-action or React import
// here, so these are cheap to unit test.
//
// Slug rules mirror docs/systemdocs/SYNC.md's zones.yaml conventions: a slug
// is what db:import-zones and every existing archive/roles
// reference matches on, so it has to be a safe, stable identifier — lowercase
// letters, digits and hyphens, starting with a letter, same shape a Discord
// channel/role name tolerates without mangling.
const SLUG_RE = /^[a-z][a-z0-9-]*$/;

function validateSlugShape(slug) {
  const value = (slug ?? "").toString().trim();
  if (!value) return "A slug is required.";
  if (value.length > 64) return "Keep the slug under 64 characters.";
  if (!SLUG_RE.test(value)) {
    return "A slug is lowercase letters, digits and hyphens, starting with a letter (e.g. \"town-square\").";
  }
  return null;
}

// Slugs are one namespace across Zone, Location and Room (placeKey.js,
// docs/zones.yaml's own `seen` check) — a Location and a Room can never share
// one, because db:import-zones matches by slug alone regardless of kind.
async function slugIsTaken(prisma, slug, { excludeKind, excludeId } = {}) {
  const skip = (kind) => excludeKind === kind && excludeId;
  const [zone, location, room] = await Promise.all([
    skip("zone") ? prisma.zone.findFirst({ where: { slug, id: { not: excludeId } } }) : prisma.zone.findUnique({ where: { slug } }),
    skip("location")
      ? prisma.location.findFirst({ where: { slug, id: { not: excludeId } } })
      : prisma.location.findUnique({ where: { slug } }),
    skip("room") ? prisma.room.findFirst({ where: { slug, id: { not: excludeId } } }) : prisma.room.findUnique({ where: { slug } }),
  ]);
  return Boolean(zone || location || room);
}

// Full slug validation for create: shape plus cross-table uniqueness.
async function validateNewSlug(prisma, slug) {
  const shapeError = validateSlugShape(slug);
  if (shapeError) return shapeError;
  if (await slugIsTaken(prisma, slug.trim())) return `The slug "${slug.trim()}" is already in use.`;
  return null;
}

function validateName(name, { label = "name" } = {}) {
  const value = (name ?? "").toString().trim();
  if (!value) return `A ${label} is required.`;
  if (value.length > 100) return `Keep the ${label} under 100 characters.`;
  return null;
}

// Name uniqueness scope differs per kind, per the plan: Zone names are
// unique globally, Location names are unique globally (they become channel
// names, and adoption-by-name in the mirror depends on that), Room names are
// unique per Location (they become thread names under one channel).
async function nameIsTaken(prisma, kind, name, { locationId = null, excludeId = null } = {}) {
  const where = { name, ...(excludeId ? { id: { not: excludeId } } : {}) };
  if (kind === "zone") return Boolean(await prisma.zone.findFirst({ where }));
  if (kind === "location") return Boolean(await prisma.location.findFirst({ where }));
  if (kind === "room") return Boolean(await prisma.room.findFirst({ where: { ...where, locationId } }));
  throw new Error(`placeValidation: unknown kind "${kind}"`);
}

async function validateUniqueName(prisma, kind, name, opts = {}) {
  const nameError = validateName(name, { label: kind });
  if (nameError) return nameError;
  if (await nameIsTaken(prisma, kind, name.trim(), opts)) {
    return `Another ${kind} is already named "${name.trim()}".`;
  }
  return null;
}

module.exports = {
  SLUG_RE,
  validateSlugShape,
  slugIsTaken,
  validateNewSlug,
  validateName,
  nameIsTaken,
  validateUniqueName,
};
