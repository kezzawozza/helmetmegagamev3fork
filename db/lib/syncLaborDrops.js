// docs/labordrops.yaml -> LaborDropOption. Called by `npm run db:sync-labor-drops`. See docs/systemdocs/LABORDROPS.md for the shape. DESTRUCTIVE,
// unconditionally: every row is deleted and rebuilt each run, same posture as db:sync-documents (SYNC.md §1) — nothing points AT this row. Run
// AFTER db:sync-zones and db:sync-tags: every tag/zone/location slug named below is validated against those catalogs.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");
const { TIER_TO_LABOR_DROP_TYPE } = require("./laborDrops");

const LABOR_TYPE_KEYS = new Set(Object.keys(TIER_TO_LABOR_DROP_TYPE));
const TOP_LEVEL_KEYS = new Set(["global", "laborType", "zone", "location", "laborTypeZone", "laborTypeLocation"]);

function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

const { TIERS } = require("./labordropsRarity");

function loadDoc() {
  return yaml.load(fs.readFileSync(requireDocsPath("labordrops.yaml"), "utf8"));
}

// YAML rarity name -> the LaborDropRarity enum. The six are db/lib/labordropsRarity.js's TIERS.
const RARITY_BY_NAME = new Map(TIERS.map((t) => [t, t.toUpperCase().replace(/-/g, "_")]));

// One pool item -> a partial LaborDropOption row, or throws. Two shapes: a bare scalar is "nothing" (explicit no-result) or "+N"/"-N" (a Resources
// change) — neither takes a rarity. Anything findable is an object carrying its rarity: `{ slug: blind-fish, rarity: common }`. Rarity is REQUIRED
// on a tag so an entry's odds come from a stated word, not from how many times it was copy-pasted.
function parsePoolEntry(raw, where, tagIdBySlug) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const slug = String(raw.slug ?? "").trim();
    if (!slug) {
      throw new Error(`labordrops.yaml: an entry in ${where} has no "slug"`);
    }
    const tagId = tagIdBySlug.get(slug);
    if (!tagId) throw new Error(`labordrops.yaml: unknown tag slug "${slug}" in ${where}`);
    const name = String(raw.rarity ?? "").trim();
    if (!name) {
      throw new Error(
        `labordrops.yaml: "${slug}" in ${where} has no rarity — every find needs one of: ${TIERS.join(", ")}`,
      );
    }
    const rarity = RARITY_BY_NAME.get(name);
    if (!rarity) {
      throw new Error(
        `labordrops.yaml: "${slug}" in ${where} has rarity "${name}" — expected one of: ${TIERS.join(", ")}`,
      );
    }
    return { kind: "TAG", tagId, rarity };
  }

  const value = String(raw).trim();
  if (/^nothing$/i.test(value)) return { kind: "NOTHING" };
  const bonus = /^([+-]\d+)$/.exec(value);
  if (bonus) return { kind: "RESOURCES", resourceAmount: Number(bonus[1]) };
  // A bare slug is the commonest way this file gets edited wrong, so it gets its own message rather than "unknown tag".
  if (tagIdBySlug.has(value)) {
    throw new Error(
      `labordrops.yaml: "${value}" in ${where} needs a rarity — write { slug: ${value}, rarity: common }`,
    );
  }
  throw new Error(`labordrops.yaml: unknown tag slug "${value}" in ${where}`);
}

function parseRoll(key, where) {
  const n = Number(key);
  if (!Number.isInteger(n) || n < 1 || n > 6) {
    throw new Error(`labordrops.yaml: "${key}" is not a valid die face 1-6, in ${where}`);
  }
  return n;
}

// A scope node is a map whose keys are EITHER a die face 1-6 (a plain pool) OR the literal key "requiresTag" (a map of skill slug -> another scope
// node, gated on that tag). "requiresTag" nests at any depth via plain recursion — a double-gated requiresTag.a.requiresTag.b parses the same way.
function rowsFromScopeNode(node, where, scope, catalogs) {
  const rows = [];
  for (const [key, value] of Object.entries(node ?? {})) {
    if (key === "requiresTag") {
      for (const [skillSlug, subNode] of Object.entries(value ?? {})) {
        const requiredTagId = catalogs.tagIdBySlug.get(skillSlug);
        if (!requiredTagId) {
          throw new Error(`labordrops.yaml: unknown skill slug "${skillSlug}" in ${where}.requiresTag`);
        }
        rows.push(
          ...rowsFromScopeNode(subNode, `${where}.requiresTag.${skillSlug}`, { ...scope, requiredTagId }, catalogs),
        );
      }
      continue;
    }
    const roll = parseRoll(key, where);
    if (!Array.isArray(value)) {
      throw new Error(`labordrops.yaml: ${where} roll ${key} must be a list`);
    }
    // Repeat-to-weight is gone (db/lib/labordropsRarity.js), so a slug twice in one pool means somebody copy-pasted, not "twice as likely".
    const seen = new Set();
    for (const raw of value) {
      const row = parsePoolEntry(raw, `${where} roll ${key}`, catalogs.tagIdBySlug);
      if (row.kind === "TAG") {
        if (seen.has(row.tagId)) {
          throw new Error(
            `labordrops.yaml: ${where} roll ${key} lists the same tag twice — say it once and set its rarity`,
          );
        }
        seen.add(row.tagId);
      } else if (row.kind === "NOTHING") {
        if (seen.has("nothing")) {
          throw new Error(
            `labordrops.yaml: ${where} roll ${key} has more than one "nothing" — the miss rate is the face's column now, not a pad count`,
          );
        }
        seen.add("nothing");
      }
      rows.push({ roll, ...scope, ...row });
    }
  }
  return rows;
}

function resolveLaborType(key, where) {
  if (!LABOR_TYPE_KEYS.has(key)) {
    throw new Error(`labordrops.yaml: "${key}" is not a labor type (expected one of ${[...LABOR_TYPE_KEYS].join(", ")}), in ${where}`);
  }
  return TIER_TO_LABOR_DROP_TYPE[key];
}

function resolveZoneId(slug, where, catalogs) {
  const id = catalogs.zoneIdBySlug.get(slug);
  if (!id) throw new Error(`labordrops.yaml: unknown zone slug "${slug}" in ${where}`);
  return id;
}

function resolveLocationId(slug, where, catalogs) {
  const id = catalogs.locationIdBySlug.get(slug);
  if (!id) throw new Error(`labordrops.yaml: unknown location slug "${slug}" in ${where}`);
  return id;
}

function parseDoc(doc, catalogs) {
  for (const key of Object.keys(doc ?? {})) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw new Error(`labordrops.yaml: unknown top-level bucket "${key}" (expected one of ${[...TOP_LEVEL_KEYS].join(", ")})`);
    }
  }

  const rows = [];

  rows.push(...rowsFromScopeNode(doc?.global, "global", { laborType: null, zoneId: null, locationId: null }, catalogs));

  for (const [laborTypeKey, scopeNode] of Object.entries(doc?.laborType ?? {})) {
    const laborType = resolveLaborType(laborTypeKey, `laborType.${laborTypeKey}`);
    rows.push(...rowsFromScopeNode(scopeNode, `laborType.${laborTypeKey}`, { laborType, zoneId: null, locationId: null }, catalogs));
  }

  for (const [zoneSlug, scopeNode] of Object.entries(doc?.zone ?? {})) {
    const zoneId = resolveZoneId(zoneSlug, `zone.${zoneSlug}`, catalogs);
    rows.push(...rowsFromScopeNode(scopeNode, `zone.${zoneSlug}`, { laborType: null, zoneId, locationId: null }, catalogs));
  }

  for (const [locationSlug, scopeNode] of Object.entries(doc?.location ?? {})) {
    const locationId = resolveLocationId(locationSlug, `location.${locationSlug}`, catalogs);
    rows.push(...rowsFromScopeNode(scopeNode, `location.${locationSlug}`, { laborType: null, zoneId: null, locationId }, catalogs));
  }

  for (const [laborTypeKey, zones] of Object.entries(doc?.laborTypeZone ?? {})) {
    const laborType = resolveLaborType(laborTypeKey, `laborTypeZone.${laborTypeKey}`);
    for (const [zoneSlug, scopeNode] of Object.entries(zones ?? {})) {
      const where = `laborTypeZone.${laborTypeKey}.${zoneSlug}`;
      const zoneId = resolveZoneId(zoneSlug, where, catalogs);
      rows.push(...rowsFromScopeNode(scopeNode, where, { laborType, zoneId, locationId: null }, catalogs));
    }
  }

  for (const [laborTypeKey, locations] of Object.entries(doc?.laborTypeLocation ?? {})) {
    const laborType = resolveLaborType(laborTypeKey, `laborTypeLocation.${laborTypeKey}`);
    for (const [locationSlug, scopeNode] of Object.entries(locations ?? {})) {
      const where = `laborTypeLocation.${laborTypeKey}.${locationSlug}`;
      const locationId = resolveLocationId(locationSlug, where, catalogs);
      rows.push(...rowsFromScopeNode(scopeNode, where, { laborType, zoneId: null, locationId }, catalogs));
    }
  }

  return rows;
}

async function syncLaborDropsFromYaml(prisma) {
  const doc = loadDoc();

  const [tags, zones, locations] = await Promise.all([
    prisma.tag.findMany({ select: { id: true, slug: true } }),
    prisma.zone.findMany({ select: { id: true, slug: true } }),
    prisma.location.findMany({ select: { id: true, slug: true } }),
  ]);
  const catalogs = {
    tagIdBySlug: new Map(tags.map((t) => [t.slug, t.id])),
    zoneIdBySlug: new Map(zones.map((z) => [z.slug, z.id])),
    locationIdBySlug: new Map(locations.map((l) => [l.slug, l.id])),
  };

  const rows = parseDoc(doc, catalogs);

  await prisma.$transaction([
    prisma.laborDropOption.deleteMany({}),
    ...(rows.length ? [prisma.laborDropOption.createMany({ data: rows })] : []),
  ]);

  return { total: rows.length };
}

// loadDoc/parseDoc are exported for db/scripts/ops/audit-labor-drops.js, which reads the YAML straight off disk (no sync required first).
module.exports = { syncLaborDropsFromYaml, loadDoc, parseDoc };
