// docs/zones.yaml -> DB, one-shot and additive. `npm run db:import-zones`.
//
// This is the whole replacement for the old destructive zones sync: it
// creates a Zone/Location/Room/LocationLink/LocationMining/Structure that the
// YAML names and the database doesn't have yet, by slug (a link by its
// endpoint pair, a yield by location+kind, a structure by location+type).
// Anything that already exists is left exactly alone — never updated, never
// deleted. Standing up a fresh game, or adding a new region to a running one,
// is the whole use case; reconciling drift is the mirror's job now
// (db/lib/discordMirror/), not this importer's.
//
// It never writes a `discord*Id` column. That is the mirror's column to
// write, on the next drain — see the `enqueueMirror` calls at the bottom.
//
// Dry run by default (`apply: false`): everything below is computed and
// reported, nothing is written. `apply: true` writes it.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");
const { parseZonesYaml } = require("./syncZones/parse");
const { orderEndpoints } = require("./locationGraph");
const { PRESENT_STATUSES } = require("./structures");
const { enqueueMirror } = require("./discordMirror/queue");

function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

function readZonesYaml() {
  const yamlPath = requireDocsPath("zones.yaml");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  return parseZonesYaml(doc);
}

// `doc` lets a test hand in an already-parsed YAML fixture instead of reading
// docs/zones.yaml off disk — the only reason this isn't just `readZonesYaml()`
// called unconditionally below.
async function importZonesFromYaml(prisma, { apply = false, doc = null } = {}) {
  const { zoneEntries, locationEntries, roomEntries, connections, warnings } = doc
    ? parseZonesYaml(doc)
    : readZonesYaml();

  const report = {
    apply,
    warnings: [...warnings],
    created: { zones: [], locations: [], rooms: [], links: [], yields: [], structures: [] },
    skipped: [],
    mirrorTargets: [],
  };

  // --- Zones, parents before children -----------------------------------
  const zonesBySlug = new Map(
    (await prisma.zone.findMany()).map((z) => [z.slug, z]),
  );
  const ordered = [...zoneEntries].sort((a, b) => (a.parentSlug ? 1 : 0) - (b.parentSlug ? 1 : 0));
  for (const entry of ordered) {
    if (zonesBySlug.has(entry.slug)) {
      report.skipped.push(`skipped zone "${entry.slug}" (exists)`);
      continue;
    }
    const parent = entry.parentSlug ? zonesBySlug.get(entry.parentSlug) : null;
    if (entry.parentSlug && !parent) {
      report.warnings.push(`zone "${entry.slug}" names unknown parent "${entry.parentSlug}" — skipped`);
      continue;
    }
    const data = {
      slug: entry.slug,
      name: entry.name,
      kind: entry.kind,
      sortOrder: entry.sortOrder,
      description: entry.description,
      parentZoneId: parent?.id ?? null,
      mapPolygon: entry.mapPolygon ?? undefined,
      mapLabelX: entry.mapLabelX,
      mapLabelY: entry.mapLabelY,
    };
    if (!apply) {
      zonesBySlug.set(entry.slug, { ...data, id: `dry:${entry.slug}` });
      report.created.zones.push(entry.slug);
      continue;
    }
    const zone = await prisma.zone.create({ data });
    // seatZoneId: the same rule the sync used — parentZoneId, or the zone's
    // own id when it has none.
    const seatZoneId = zone.parentZoneId ?? zone.id;
    await prisma.zone.update({ where: { id: zone.id }, data: { seatZoneId } });
    zone.seatZoneId = seatZoneId;
    zonesBySlug.set(entry.slug, zone);
    report.created.zones.push(entry.slug);
    report.mirrorTargets.push({ targetType: "zone", targetId: zone.id });
  }

  // --- Locations -----------------------------------------------------------
  const locationsBySlug = new Map(
    (await prisma.location.findMany()).map((l) => [l.slug, l]),
  );
  for (const entry of locationEntries) {
    if (locationsBySlug.has(entry.slug)) {
      report.skipped.push(`skipped location "${entry.slug}" (exists)`);
      continue;
    }
    const zone = zonesBySlug.get(entry.zoneSlug);
    if (!zone) {
      report.warnings.push(`location "${entry.slug}" names unknown zone "${entry.zoneSlug}" — skipped`);
      continue;
    }
    const data = {
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      indoors: entry.indoors,
      attributes: entry.attributes,
      sortOrder: entry.sortOrder,
      zoneId: zone.id,
    };
    let location;
    if (!apply) {
      location = { ...data, id: `dry:${entry.slug}` };
    } else {
      location = await prisma.location.create({ data });
      report.mirrorTargets.push({ targetType: "location", targetId: location.id });
    }
    locationsBySlug.set(entry.slug, location);
    report.created.locations.push(entry.slug);

    // The mining coefficient, only if it's actually missing — a location that
    // already existed (skipped above) never has its yield touched here.
    if (entry.mining != null) {
      if (apply) {
        const existing = await prisma.locationMining
          .findUnique({ where: { locationId: location.id } })
          .catch(() => null);
        if (!existing) {
          await prisma.locationMining.create({
            data: { locationId: location.id, base: entry.mining, current: entry.mining },
          });
        }
      }
      report.created.yields.push(`${entry.slug}/mining`);
    }

    // Structures: seeded once, the same "nothing PRESENT of this type yet"
    // floor the old sync used — never a stash the importer restocks.
    for (const slug of entry.structures ?? []) {
      if (apply) {
        const tag = await prisma.tag.findUnique({ where: { slug }, select: { name: true } });
        if (!tag) {
          report.warnings.push(`location "${entry.slug}" structures names unknown tag "${slug}" — run db:sync-tags first`);
          continue;
        }
        const standing = await prisma.structure.count({
          where: { locationId: location.id, typeSlug: slug, status: { in: PRESENT_STATUSES } },
        });
        if (standing > 0) {
          report.skipped.push(`skipped structure "${entry.slug}/${slug}" (exists)`);
          continue;
        }
        await prisma.structure.create({
          data: {
            locationId: location.id,
            typeSlug: slug,
            typeName: tag.name,
            status: "COMPLETE",
            turnsNeeded: 1,
            turnsDone: 1,
            resourcesCost: 0,
          },
        });
      }
      report.created.structures.push(`${entry.slug}/${slug}`);
    }
  }

  // --- Rooms -----------------------------------------------------------------
  const roomsBySlug = new Map((await prisma.room.findMany()).map((r) => [r.slug, r]));
  for (const entry of roomEntries) {
    if (roomsBySlug.has(entry.slug)) {
      report.skipped.push(`skipped room "${entry.slug}" (exists)`);
      continue;
    }
    const location = locationsBySlug.get(entry.locationSlug);
    if (!location) {
      report.warnings.push(`room "${entry.slug}" names unknown location "${entry.locationSlug}" — skipped`);
      continue;
    }
    const data = {
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      sortOrder: entry.sortOrder,
      kind: entry.kind,
      accessTagSlugs: entry.accessTagSlugs,
      destroysContents: entry.destroysContents,
      soundproof: entry.soundproof,
      live: entry.live,
      locationId: location.id,
    };
    if (apply) {
      const room = await prisma.room.create({ data });
      roomsBySlug.set(entry.slug, room);
      report.mirrorTargets.push({ targetType: "room", targetId: room.id });
    } else {
      roomsBySlug.set(entry.slug, { ...data, id: `dry:${entry.slug}` });
    }
    report.created.rooms.push(entry.slug);

    if (entry.stash?.resources > 0 || entry.stash?.items?.length) {
      report.warnings.push(`room "${entry.slug}" has a stash in the YAML — seed from /gm/dev/zones, not the importer`);
    }
  }

  // --- LocationLink ------------------------------------------------------
  for (const entry of connections) {
    const locA = locationsBySlug.get(entry.a);
    const locB = locationsBySlug.get(entry.b);
    if (!locA || !locB) continue; // one endpoint was skipped above for a reason already reported
    const { aId, bId } = orderEndpoints(entry.a, locA.id, entry.b, locB.id);
    const pairLabel = `${entry.a} <-> ${entry.b}`;
    if (!apply) {
      // Dry-run ids are placeholders, so existence can only be checked against
      // real rows; a link between two dry-run locations is reported created.
      if (String(aId).startsWith("dry:") || String(bId).startsWith("dry:")) {
        report.created.links.push(pairLabel);
        continue;
      }
    }
    const existing = await prisma.locationLink.findUnique({ where: { aId_bId: { aId, bId } } }).catch(() => null);
    if (existing) {
      report.skipped.push(`skipped link "${pairLabel}" (exists)`);
      continue;
    }
    if (apply) {
      await prisma.locationLink.create({
        data: {
          aId,
          bId,
          announce: entry.announce,
          requiredTagSlug: entry.requiredTagSlug,
          hidden: entry.hidden,
          modular: entry.modular,
          authoredOpen: entry.isOpen,
          isOpen: entry.isOpen,
          openerRoleSlugs: [],
          openerTagSlugs: [],
          keyed: entry.keyed,
          onFoot: entry.onFoot,
        },
      });
    }
    report.created.links.push(pairLabel);
  }

  if (apply) {
    for (const target of report.mirrorTargets) {
      await enqueueMirror(prisma, target.targetType, target.targetId, "created by db:import-zones");
    }
  }

  return report;
}

module.exports = { importZonesFromYaml };
