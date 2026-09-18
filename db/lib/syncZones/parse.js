// syncZones Pass 0: parse + validate docs/zones.yaml into zone, location and
// room entries plus the location graph, and the overwrite-reconcile helpers
// used later by the sync. Split out of db/lib/syncZones.js — see that file.
const { SPECTATOR_ROLE_ID, gmRoleIds } = require("../roleIds");
const { collectAttributes } = require("../locationAttributes");
const { collectLive } = require("../roomLive");
const { entriesOf } = require("../yamlEntries");
const { putChannelOverwrite, deleteChannelOverwrite, getChannel } = require("../discordRest");

const KIND_BY_YAML = { surface: "SURFACE", group: "CAVE_GROUP" };

// --- Pass 0: parse + validate ------------------------------------------

// Flattens the YAML into zone/location/room entries plus the location graph.
// Throws on anything structurally wrong; a bad master must fail before the first write.
function parseZonesYaml(doc) {
  const zoneEntries = [];
  const locationEntries = [];
  const roomEntries = [];
  const problems = [];
  const warnings = [];

  for (const [index, zone] of entriesOf(doc?.zones, "id").entries()) {
    if (!zone?.id) {
      problems.push(`zones[${index}] has no id`);
      continue;
    }
    const kind = KIND_BY_YAML[zone.kind ?? "surface"];
    if (!kind) {
      problems.push(`zone "${zone.id}" has unknown kind "${zone.kind}"`);
      continue;
    }

    zoneEntries.push({
      slug: zone.id,
      name: zone.name ?? zone.id,
      kind,
      sortOrder: zone.sort ?? index + 1,
      description: zone.description ?? "",
      parentSlug: null,
      mapPolygon: zone.map?.polygon ?? null,
      mapLabelX: zone.map?.label?.x ?? null,
      mapLabelY: zone.map?.label?.y ?? null,
    });

    if (kind === "CAVE_GROUP") {
      if (entriesOf(zone.locations, "id").length > 0) {
        problems.push(`group zone "${zone.id}" carries locations — they belong on its levels`);
      }
      for (const [levelIndex, level] of entriesOf(zone.levels, "id").entries()) {
        if (!level?.id) {
          problems.push(`zone "${zone.id}" levels[${levelIndex}] has no id`);
          continue;
        }
        zoneEntries.push({
          slug: level.id,
          name: level.name ?? level.id,
          kind: "CAVE_LEVEL",
          sortOrder: levelIndex + 1,
          description: level.description ?? "",
          parentSlug: zone.id,
          mapPolygon: level.map?.polygon ?? null,
          mapLabelX: level.map?.label?.x ?? null,
          mapLabelY: level.map?.label?.y ?? null,
        });
        collectLocations(level, level.id, locationEntries, roomEntries, problems);
      }
    } else {
      if (entriesOf(zone.levels, "id").length > 0) {
        problems.push(`zone "${zone.id}" carries levels but is not kind: group`);
      }
      collectLocations(zone, zone.id, locationEntries, roomEntries, problems);
    }
  }

  // Zone/location/room slugs share one namespace.
  const seen = new Set();
  for (const entry of [...zoneEntries, ...locationEntries, ...roomEntries]) {
    if (seen.has(entry.slug)) problems.push(`duplicate slug "${entry.slug}"`);
    seen.add(entry.slug);
  }

  // A presence zone with no location is a zone nobody can stand in.
  for (const zone of zoneEntries) {
    if (zone.kind === "CAVE_GROUP") continue;
    if (!locationEntries.some((l) => l.zoneSlug === zone.slug)) {
      problems.push(`zone "${zone.slug}" has no locations — a character has nowhere to stand`);
    }
  }

  // connections: pairs of "zone/location".
  const locationByRef = new Map(locationEntries.map((l) => [`${l.zoneSlug}/${l.slug}`, l]));
  const connections = [];
  for (const raw of doc?.connections ?? []) {
    const entry = parseConnection(raw, locationByRef, problems);
    if (entry) connections.push(entry);
  }

  // Two entries for one pair would claim the same unique row, the later silently winning.
  const seenPairs = new Set();
  for (const entry of connections) {
    const key = [entry.a, entry.b].sort().join(" <-> ");
    if (seenPairs.has(key)) problems.push(`connections lists ${key} twice`);
    seenPairs.add(key);
  }

  // A location with no road is legal but almost always a typo.
  const connected = new Set(connections.flatMap((c) => [c.a, c.b]));
  for (const location of locationEntries) {
    if (!connected.has(location.slug)) {
      warnings.push(`location "${location.zoneSlug}/${location.slug}" appears in no connections entry — it is unreachable`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`docs/zones.yaml is invalid:\n  - ${problems.join("\n  - ")}`);
  }
  return { zoneEntries, locationEntries, roomEntries, connections, warnings };
}

// One `connections:` entry. Two forms, both legal:
//
//   - [town/square, town/cathedral]              a plain open road
//   - pair: [fortress/gatehouse, fortress/road]  anything else
//     announce: true_name | concealed
//     locked: <tag-slug>
//     hidden: <tag-slug>
//     modular: { roles: [...], tags: [...], open: true }
//     keyed: true
//     on_foot: true
//
// `locked`/`hidden` are the same requirement with different visibility, one
// column, `hidden` sets the flag too. Tag/Role slugs are NOT validated here —
// tags and roles sync after zones (SYNC.md) — db:doctor validates them instead.
const ANNOUNCE_BY_KEYWORD = new Map([
  ["true_name", "TRUE_NAME"],
  ["gate", "TRUE_NAME"],
  ["concealed", "CONCEALED"],
  ["unmanned", "CONCEALED"],
]);

const CONNECTION_KEYS = new Set(["pair", "announce", "locked", "hidden", "modular", "keyed", "on_foot"]);

function parseConnection(raw, locationByRef, problems) {
  const isPair = Array.isArray(raw);
  const spec = isPair ? { pair: raw } : raw;
  if (!spec || typeof spec !== "object") {
    problems.push(`connections entry ${JSON.stringify(raw)} is neither a pair nor a mapping`);
    return null;
  }
  if (!isPair) {
    for (const key of Object.keys(spec)) {
      if (!CONNECTION_KEYS.has(key)) {
        problems.push(`connections entry has unknown key "${key}" (want ${[...CONNECTION_KEYS].join(", ")})`);
      }
    }
  }

  const pair = spec.pair;
  if (!Array.isArray(pair) || pair.length !== 2) {
    problems.push(`connections entry ${JSON.stringify(raw)} is not a pair`);
    return null;
  }
  const resolved = pair.map((ref) => {
    const location = locationByRef.get(String(ref));
    if (!location) problems.push(`connections references unknown location "${ref}" (want zone/location)`);
    return location?.slug ?? null;
  });
  if (!resolved.every(Boolean)) return null;
  if (resolved[0] === resolved[1]) {
    problems.push(`connections entry ${JSON.stringify(pair)} joins a location to itself`);
    return null;
  }

  const entry = {
    a: resolved[0],
    b: resolved[1],
    announce: "NONE",
    requiredTagSlug: null,
    hidden: false,
    modular: false,
    isOpen: true,
    keyed: false,
    onFoot: false,
  };

  if (spec.announce != null) {
    const announce = ANNOUNCE_BY_KEYWORD.get(String(spec.announce).toLowerCase());
    if (!announce) {
      problems.push(
        `connections ${entry.a} <-> ${entry.b} has announce "${spec.announce}" (want ${[...ANNOUNCE_BY_KEYWORD.keys()].join(", ")})`,
      );
    } else {
      entry.announce = announce;
    }
  }

  if (spec.locked != null && spec.hidden != null) {
    problems.push(`connections ${entry.a} <-> ${entry.b} sets both locked and hidden — hidden already requires its tag`);
  }
  for (const [key, hides] of [["locked", false], ["hidden", true]]) {
    if (spec[key] == null) continue;
    if (typeof spec[key] !== "string" || !spec[key].trim()) {
      problems.push(`connections ${entry.a} <-> ${entry.b} has a non-slug ${key}: ${JSON.stringify(spec[key])}`);
      continue;
    }
    entry.requiredTagSlug = spec[key].trim();
    entry.hidden = hides;
  }

  // A way no arelitz or cart fits through — gates on what's EQUIPPED, refuses at the threshold rather than parking the mount on arrival.
  if (spec.on_foot != null) {
    if (typeof spec.on_foot !== "boolean") {
      problems.push(`connections ${entry.a} <-> ${entry.b} has a non-boolean on_foot: ${JSON.stringify(spec.on_foot)}`);
    } else {
      entry.onFoot = spec.on_foot;
    }
  }

  // `keyed` only means anything on a way shut to somebody — holds it open 24h. No requirement, nothing to hold.
  if (spec.keyed != null) {
    if (typeof spec.keyed !== "boolean") {
      problems.push(`connections ${entry.a} <-> ${entry.b} has a non-boolean keyed: ${JSON.stringify(spec.keyed)}`);
    } else if (spec.keyed && !entry.requiredTagSlug) {
      problems.push(
        `connections ${entry.a} <-> ${entry.b} is keyed but names no locked or hidden tag — there is nothing to hold open`,
      );
    } else {
      entry.keyed = spec.keyed;
    }
  }

  if (spec.modular != null) {
    const modular = spec.modular === true ? {} : spec.modular;
    if (typeof modular !== "object" || Array.isArray(modular)) {
      problems.push(`connections ${entry.a} <-> ${entry.b} has a modular that is not a mapping`);
    } else {
      entry.modular = true;
      entry.isOpen = modular.open !== false;
    }
  }

  return entry;
}

// Per-location `mining: 0.9` -> the coefficient, or null. A location without
// the key cannot be mined at all, which is different from being worth zero.
const MINING_MAX = 2;

function collectMining(location, problems) {
  const raw = location.mining;
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > MINING_MAX) {
    problems.push(`location "${location.id}" mining must be a number between 0 and ${MINING_MAX}`);
    return null;
  }
  // A zero is almost certainly a mistake — say so rather than write nothing silently.
  if (value === 0) {
    problems.push(`location "${location.id}" mining is 0; omit the key instead`);
    return null;
  }
  return value;
}

// A room's `stash:` in two shapes: a plain list of slugs (one each), or a map
// with `resources:` and `items:` (slug -> count). Both normalise to
// { resources, items: [[slug, quantity], ...] }. A count that isn't a
// positive whole number is a PROBLEM, not a silent 1.
function parseStash(raw, roomId, problems) {
  const empty = { resources: 0, items: [] };
  if (raw == null) return empty;

  if (Array.isArray(raw)) {
    return { resources: 0, items: raw.map(String).filter(Boolean).map((slug) => [slug, 1]) };
  }
  if (typeof raw !== "object") {
    problems.push(`room "${roomId}" has a stash that is neither a list nor a map`);
    return empty;
  }

  const out = { resources: 0, items: [] };
  const count = (value, label) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) {
      problems.push(`room "${roomId}" stash ${label} must be a whole number of at least 1`);
      return null;
    }
    return n;
  };

  if (raw.resources != null) {
    const n = count(raw.resources, "resources");
    if (n != null) out.resources = n;
  }
  if (raw.items != null) {
    if (typeof raw.items !== "object" || Array.isArray(raw.items)) {
      problems.push(`room "${roomId}" stash items: must be a map of slug -> count`);
    } else {
      for (const [slug, value] of Object.entries(raw.items)) {
        const n = count(value, `items.${slug}`);
        if (n != null) out.items.push([slug, n]);
      }
    }
  }
  for (const key of Object.keys(raw)) {
    if (key !== "resources" && key !== "items") {
      problems.push(`room "${roomId}" stash has unknown key "${key}"`);
    }
  }
  return out;
}

// A Location's `structures:` — things always standing there, like the
// Square's cross. Flat list of placement-tag slugs; seedLocationStructures
// creates one COMPLETE row each. Not checked against the catalog here — tags
// sync after zones, so the lookup happens at seed time.
function parseStructures(raw, locationId, problems) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    problems.push(`location "${locationId}" structures: must be a list of tag slugs`);
    return [];
  }
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry.trim()) {
      problems.push(`location "${locationId}" structures: entries must be tag slugs`);
      continue;
    }
    const slug = entry.trim();
    if (out.includes(slug)) {
      problems.push(`location "${locationId}" structures lists "${slug}" twice`);
      continue;
    }
    out.push(slug);
  }
  return out;
}

function collectLocations(zone, zoneSlug, locationEntries, roomEntries, problems) {
  for (const [index, location] of entriesOf(zone.locations, "id").entries()) {
    if (!location?.id) {
      problems.push(`zone "${zoneSlug}" locations[${index}] has no id`);
      continue;
    }
    locationEntries.push({
      slug: location.id,
      name: location.name ?? location.id,
      description: location.description ?? "",
      indoors: location.indoors === true,
      attributes: collectAttributes(location.attributes, `location "${location.id}"`, problems),
      sortOrder: index,
      zoneSlug,
      mining: collectMining(location, problems),
      structures: parseStructures(location.structures, location.id, problems),
    });
    for (const [roomIndex, room] of entriesOf(location.rooms, "id").entries()) {
      if (!room?.id) {
        problems.push(`location "${location.id}" rooms[${roomIndex}] has no id`);
        continue;
      }
      const access = Array.isArray(room.access) ? room.access.map(String).filter(Boolean) : [];
      if (room.access != null && !Array.isArray(room.access)) {
        problems.push(`room "${room.id}" has a non-list access:`);
      }
      roomEntries.push({
        slug: room.id,
        name: room.name ?? room.id,
        description: room.description ?? "",
        sortOrder: roomIndex,
        kind: access.length > 0 ? "PRIVATE" : "PUBLIC",
        accessTagSlugs: access,
        destroysContents: room.destroys === true,
        soundproof: room.soundproof === true,
        // Arelitz are kept here (ARELITZ.md). db/lib/stablePass.js resolves
        // "the stable floor" as every Room carrying this — generically,
        // never a hardcoded Room id — so moving the Stable later is a YAML
        // edit here, not a code change.
        stable: room.stable === true,
        live: collectLive(room.live, `room "${room.id}"`, problems),
        stash: parseStash(room.stash, room.id, problems),
        locationSlug: location.id,
      });
    }
  }
}

// The overwrite targets this sync may DELETE. @everyone is deliberately NOT
// in the set — its ViewChannel deny is what the whole privacy model rests on.
// Neither is any MEMBER target: a Location channel is opened per-member to
// whoever stands in it, and a wildcard here would evict every player on the
// next sync. Only role ids belong in this set.
function managedOverwriteIds(roleIds) {
  return new Set(
    [...gmRoleIds(), SPECTATOR_ROLE_ID, ...roleIds].filter(Boolean),
  );
}

// Reconciles one channel's overwrites: PUT everything the spec names, then
// DELETE any managed target no longer named. One request per target, never a
// wholesale PATCH, which would evict grants this sync doesn't own (narrowcast).
async function reconcileChannelOverwrites(channelId, want, managed) {
  const wanted = new Map(want.permission_overwrites.map((o) => [o.id, o]));
  const changes = [];

  for (const overwrite of wanted.values()) {
    await putChannelOverwrite(channelId, overwrite.id, {
      allow: overwrite.allow ?? "0",
      deny: overwrite.deny ?? "0",
      type: overwrite.type,
    });
  }

  // allow404 deliberately NOT passed: a recorded channel id pointing at nothing is worth failing over.
  const live = await getChannel(channelId);
  for (const existing of live?.permission_overwrites ?? []) {
    if (wanted.has(existing.id)) continue;
    if (!managed.has(existing.id)) continue;
    await deleteChannelOverwrite(channelId, existing.id);
    changes.push(existing.id);
  }

  return changes;
}

module.exports = {
  parseZonesYaml,
  managedOverwriteIds,
  reconcileChannelOverwrites,
};
