// docs/roles.yaml -> the Role table. Called by db/scripts/sync/sync-roles.js
// (`npm run db:sync-roles`) and by wipeGameData's "Restart Game" flow
// (web/app/(app)/gm/dev/actions.js). Must run AFTER syncLocationsFromYaml and
// syncTagsFromYaml (starting_zone/starting_tags are validated against them).
// Threats live in db/lib/threats.js, not here.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");
const { assertTitlesResolve, GENDERS } = require("./titles");
const { entriesOf } = require("./yamlEntries");
const { parseStartingTag, formatStartingTag } = require("./startingTags");
const { isRoleGroupSlug } = require("./roleGroups");

// docsPath() is null only when docs/ cannot be found at all, which for a YAML
// master is fatal — a sync with no master would read as "everything was
// deleted from the file" and prune the lot. See db/lib/repoPaths.js.
function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

function loadDoc() {
  const yamlPath = requireDocsPath("roles.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

// Flattens the group -> role nesting into one list, preserving authoring order
// within a group as sortOrder so the picker reads the way the YAML does.
function parseRolesYaml(doc) {
  const roles = [];
  for (const [groupSlug, group] of Object.entries(doc?.groups ?? {})) {
    let roleOrder = 0;
    for (const role of entriesOf(group, "slug")) {
      if (!role.slug) throw new Error(`docs/roles.yaml: role "${role.name}" has no slug`);
      roles.push({
        slug: role.slug,
        name: role.name,
        intro: (role.intro ?? "").trim(),
        description: role.description ?? [],
        difficulty: role.difficulty ?? null,
        groupSlug,
        sortOrder: roleOrder++,
        // `multiple: false` means one specific named character. `weight:
        // unlimited` means uncapped. Anything else carries a numeric weight.
        isUnique: role.multiple === false,
        unlimited: role.weight === "unlimited",
        weight: typeof role.weight === "number" ? role.weight : null,
        startingResources: role.starting_resources ?? 0,
        extraStartingPoints: role.extra_starting_points ?? 0,
        startingZoneSlug: role.starting_zone ?? null,
        startingLocationSlug: role.starting_location ?? null,
        startingTagNames: role.starting_tags ?? [],
        // `bank_account: treasury | offshore`. Anything else — including
        // absent — is no account, which is what the Black Hills seats get.
        bankAccountClass:
          role.bank_account === "offshore"
            ? "OFFSHORE"
            : role.bank_account === "treasury"
              ? "TREASURY"
              : null,
        // Who may claim this seat at all — a hosting decision. It also decides
        // which seats the assignment roll fills first (db/lib/roleAssignment.js).
        requiresWhitelist: role.whitelist === true,
        // Whether a look reads the title off somebody in this seat. Default
        // ON, unlike every other flag here — most seats are public offices,
        // and only the four that live on not being known opt out. Strict
        // `!== false`, so a missing key and a typo both land as visible.
        examineVisible: role.examine_visible !== false,
        // A seat that fixes its holder's gender rather than letting them
        // choose — Baron/Heir MAN, Baroness/Successor WOMAN. Validated
        // against the enum here, so a YAML typo lands as null instead of a
        // Prisma write-time rejection with no hint which role caused it.
        lockedGender: GENDERS.includes(role.gender) ? role.gender : null,
        docElements: role.doc_elements ?? [],
      });
    }
  }
  return { roles };
}

function changed(row, data) {
  return Object.entries(data).some(([key, value]) =>
    Array.isArray(value) ? JSON.stringify(row[key]) !== JSON.stringify(value) : row[key] !== value,
  );
}

async function syncRolesFromYaml(prisma) {
  const { roles } = parseRolesYaml(loadDoc());

  const roleSlugs = new Set();
  for (const r of roles) {
    if (roleSlugs.has(r.slug)) throw new Error(`docs/roles.yaml: duplicate role slug "${r.slug}"`);
    roleSlugs.add(r.slug);
    // Up front, with the rest of the validation below: a group key nobody
    // named must stop the sync before it writes, not quietly land its roles
    // under "Elsewhere". The names live in db/lib/roleGroups.js.
    if (!isRoleGroupSlug(r.groupSlug)) {
      throw new Error(`docs/roles.yaml: role "${r.name}" is in unknown group "${r.groupSlug}" — see db/lib/roleGroups.js`);
    }
  }

  // Validate every cross-file reference before writing anything.
  const zones = await prisma.zone.findMany();
  // starting_zone must be a PRESENCE zone — the Caves group is a container,
  // not a place a character can stand.
  const presenceZoneIdBySlug = new Map(
    zones.filter((z) => z.kind !== "CAVE_GROUP").map((z) => [z.slug, z.id]),
  );
  // Name -> slug, because roles.yaml authors starting_tags as display names
  // and Role.startingTagSlugs stores the resolved slug. Built here rather than
  // at runtime: this is the one moment the two identifiers have to meet, and
  // doing it once at sync is what lets Tag.name stop being unique.
  const slugByTagName = new Map(
    (await prisma.tag.findMany({ select: { name: true, slug: true } })).map((t) => [t.name, t.slug]),
  );
  // Where a new character of the role STANDS: `starting_location` when the
  // role names one, else the first Location of its `starting_zone`.
  const locations = await prisma.location.findMany({ orderBy: { sortOrder: "asc" } });
  const locationBySlug = new Map(locations.map((l) => [l.slug, l]));
  const firstLocationByZoneId = new Map();
  for (const location of locations) {
    if (!firstLocationByZoneId.has(location.zoneId)) firstLocationByZoneId.set(location.zoneId, location);
  }
  const startingLocationFor = (entry) => {
    if (entry.startingLocationSlug) return locationBySlug.get(entry.startingLocationSlug) ?? null;
    if (!entry.startingZoneSlug) return null;
    return firstLocationByZoneId.get(presenceZoneIdBySlug.get(entry.startingZoneSlug)) ?? null;
  };

  for (const r of roles) {
    if (r.startingZoneSlug && !presenceZoneIdBySlug.has(r.startingZoneSlug)) {
      throw new Error(`docs/roles.yaml: role "${r.name}" has unknown or unstandable starting_zone "${r.startingZoneSlug}"`);
    }
    if (r.startingLocationSlug) {
      const location = locationBySlug.get(r.startingLocationSlug);
      if (!location) {
        throw new Error(`docs/roles.yaml: role "${r.name}" has unknown starting_location "${r.startingLocationSlug}" — run db:import-zones first`);
      }
      if (r.startingZoneSlug && location.zoneId !== presenceZoneIdBySlug.get(r.startingZoneSlug)) {
        throw new Error(`docs/roles.yaml: role "${r.name}": starting_location "${r.startingLocationSlug}" is not in starting_zone "${r.startingZoneSlug}"`);
      }
    }
    // An entry may carry a count — "Obol x5" — so validate and resolve the
    // parsed name rather than the raw string. See db/lib/startingTags.js.
    // The resolved list is stashed on the entry for the write below, so the
    // lookup is not repeated.
    r.startingTagSlugsResolved = r.startingTagNames.map((entry) => {
      const { slug: authored, quantity } = parseStartingTag(entry);
      const slug = slugByTagName.get(authored);
      if (!slug) {
        throw new Error(`docs/roles.yaml: role "${r.name}" has starting_tag "${authored}" not in docs/tags.yaml — run db:sync-tags first`);
      }
      return formatStartingTag(slug, quantity);
    });
  }

  const stats = { rolesCreated: 0, rolesUpdated: 0, rolesPruned: [] };

  // Pass 1: Role scalars.
  for (const entry of roles) {
    const data = {
      name: entry.name,
      intro: entry.intro,
      description: entry.description,
      difficulty: entry.difficulty,
      groupSlug: entry.groupSlug,
      sortOrder: entry.sortOrder,
      isUnique: entry.isUnique,
      unlimited: entry.unlimited,
      weight: entry.weight,
      startingResources: entry.startingResources,
      extraStartingPoints: entry.extraStartingPoints,
      startingTagSlugs: entry.startingTagSlugsResolved,
      bankAccountClass: entry.bankAccountClass,
      requiresWhitelist: entry.requiresWhitelist,
      examineVisible: entry.examineVisible,
      lockedGender: entry.lockedGender,
      docElements: entry.docElements,
      startingZoneId: entry.startingZoneSlug
        ? presenceZoneIdBySlug.get(entry.startingZoneSlug)
        : (startingLocationFor(entry)?.zoneId ?? null),
      startingLocationId: startingLocationFor(entry)?.id ?? null,
    };
    const row = await prisma.role.findUnique({ where: { slug: entry.slug } });
    if (!row) {
      await prisma.role.create({ data: { slug: entry.slug, ...data } });
      stats.rolesCreated++;
    } else if (changed(row, data)) {
      await prisma.role.update({ where: { id: row.id }, data });
      stats.rolesUpdated++;
    }
  }

  // Pass 2: prune. Unlike syncLocations (hard-destructive) this only removes
  // rows nothing points at — a Role still held by a character is left in place
  // and reported instead, since deleting it would orphan live game state.
  for (const role of await prisma.role.findMany({
    where: { slug: { notIn: [...roleSlugs] } },
    include: { _count: { select: { characters: true } } },
  })) {
    if (role._count.characters > 0) {
      console.warn(`Role "${role.name}" dropped out of roles.yaml but ${role._count.characters} character(s) still hold it — keeping`);
      continue;
    }
    await prisma.role.delete({ where: { id: role.id } });
    stats.rolesPruned.push(role.name);
  }

  // Titles are earned from tags and roles (db/lib/titles.js); both catalogs
  // exist by now (SYNC.md). Checked last so a bad reference doesn't abort a
  // sync that has already done its real work.
  await assertTitlesResolve(prisma);

  return stats;
}

module.exports = { syncRolesFromYaml };
