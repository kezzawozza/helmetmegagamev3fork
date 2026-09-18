// AUTHORED attributes live in docs/zones.yaml's `attributes:` map, change only on sync. DERIVED lines read live state via `ctx` (Prisma-free). Add an attribute in ATTRIBUTES — the sync rejects an unknown key, failing loudly.

const GODFLESH_ATTRIBUTE = "godflesh";
const REFINERY_ATTRIBUTE = "refinery";
const SOILERY_ATTRIBUTE = "soilery";
const SAFE_ATTRIBUTE = "safe";
// WILDERNESS/HAVEN read by the mood dial (db/lib/mood.js#placeClassOf); WHEELS by db/lib/indoors.js, alongside the `indoors` column.
const WILDERNESS_ATTRIBUTE = "wilderness";
const HAVEN_ATTRIBUTE = "haven";
const WHEELS_ATTRIBUTE = "wheels";

// key -> { type, options?, describe(value, ctx) -> string|null }; null
// describe means matched-on-only. `type` (default "boolean" when absent) is
// what /gm/dev/zones's Location form reads to pick a control: "boolean" a
// checkbox, "number" a number input, "enum" a <select> over `options`,
// "string" free text. Every attribute here happens to be a boolean today,
// but the type tag is what lets a future non-boolean one add a control
// without the form needing to know its name.
const ATTRIBUTES = {
  // The Merchant's berth. Exists to be matched on; lines come via ctx.depot.
  depot: {
    type: "boolean",
    describe: () => null,
  },
  noBuild: {
    type: "boolean",
    describe: () => null,
  },

  godflesh: {
    type: "boolean",
    describe: () => "**Godflesh**: you can cut it out of the water here.",
  },

  // The Godard Factory floor: the Refine button turns Godflesh into Squeeze instead of paying ⬢, no LocationMining row needed.
  refinery: {
    type: "boolean",
    describe: () => "**Refinery**: you can refine Godflesh into Squeeze here.",
  },

  // A placeholder stand-in for the Farms rework (db/lib/soilery.js): gates the Sow/Reap buttons.
  // Deliberately minimal — the whole Farms Location is expected to be redesigned later.
  soilery: {
    type: "boolean",
    describe: () => "**Soilery**: you can sow and reap crops here.",
  },

  // Ground the Caving Die skips (db/lib/cavingPass.js) — said out loud so a player can read the answer.
  safe: {
    type: "boolean",
    describe: () => "**Safe**: Caving dice don't roll here.",
  },

  // Open country (docs/systemdocs/MOOD.md); costs mood to walk in, more to end turn here — Rough Camper / Outsider soften it.
  wilderness: {
    type: "boolean",
    describe: () => "**Wilderness**: spending time here is wearying.",
  },

  // Settles a person more than any roof: the Inn, Keep, Sanctuary. Best turn-end mood relief there is.
  haven: {
    type: "boolean",
    describe: () => "**Haven**: ending your turn here calms your nerves.",
  },

  // Splits the roof question (`indoors`) from the wheels one. Means nothing outdoors.
  wheels: {
    type: "boolean",
    describe: () => "**Wheels**: you can bring a cart or a horse in here.",
  },

  // A public board to pin a paper to. What Noticeboard matches on. See docs/systemdocs/PAPERWORK.md.
  noticeboard: {
    type: "boolean",
    describe: () => "**Noticeboard**: you can pin paper here.",
  },
};

function authoredLines(location, ctx = {}) {
  const attrs = location?.attributes ?? {};
  const lines = [];
  for (const [key, entry] of Object.entries(ATTRIBUTES)) {
    const value = attrs[key];
    if (value == null || value === false) continue;
    const line = entry.describe(value, ctx);
    if (line) lines.push(line);
  }
  return lines;
}

// Real column, `wheels` the one authored exception. Only parks a mount
// underground (`zone.kind === "CAVE_LEVEL"`) — every Caves/Depths Location is
// `indoors: true`, so that's the one place a roof still costs the reins; a
// surface roof no longer does. "Cart out here?" readers use this; ROOF
// readers keep reading `indoors` straight.
function parksMounts(location) {
  if (!location?.indoors || hasAttribute(location, WHEELS_ATTRIBUTE)) return false;
  return location?.zone?.kind === "CAVE_LEVEL";
}

// Both halves print — silence outdoors would mean the rule is only stated
// where it bites. A `wheels` Location says nothing; already said above. Reads
// `parksMounts`'s answer, not the raw `indoors` column, since a surface
// Location no longer parks anything at the door.
function placementLine(location) {
  if (hasAttribute(location, WHEELS_ATTRIBUTE)) return null;
  if (!location?.indoors) return "**Outdoors**: you can use your horse or cart here.";
  return parksMounts(location)
    ? "**Indoors**: you can't equip a cart or horse here."
    : "**Indoors**: you can still bring a horse or cart in here.";
}

// Says the STATE, not the verb — buttons say what a click DOES, Examine says what IS TRUE.
function gateLines(gates) {
  return (gates ?? [])
    .slice()
    .sort((x, y) => x.farName.localeCompare(y.farName))
    .map((gate) => {
      return gate.isOpen
        ? `**${gate.farName}**: the way stands open. Worked from the watchtower.`
        : `**${gate.farName}**: the way is closed. Worked from the watchtower.`;
    });
}

// caller-loaded — must match what the web console says (an unseen turret is a trap, not a threat).
function depotLines(ctx = {}) {
  const depot = ctx.depot;
  if (!depot) return [];

  const lines = [];
  lines.push(depot.trainHere ? "**Train**: it's at the platform." : "**Train**: the rails are empty.");
  if (depot.turretArmed) {
    lines.push("**Turret**: it's armed.");
  }
  return lines;
}

// Can't import structures.js itself (cycle via hasAttribute). Oldest first; a ruin stays on the list rather than dropping off.
function structureLines(ctx = {}) {
  const structures = ctx.structures;
  if (!structures?.length) return [];
  return structures.flatMap((structure) => {
    const typeName = structure.type?.name ?? structure.typeName;
    // defenseNote prints only while the structure WORKS (COMPLETE/DAMAGED), never off a wreck — a ruined ram must not still license a storm.
    const note = structure.placement?.defenseNote;
    const noteLines = note ? [`**Defense**: ${note}`] : [];
    // Builder's inscription replaces the stock examine fragment, sanitized by web/lib/customCraft.js.
    const inscribed = structure.inscription?.trim();
    switch (structure.status) {
      case "UNDER_CONSTRUCTION":
        return [`**${typeName}**: going up, ${structure.turnsDone} of ${structure.turnsNeeded} days done.`];
      case "COMPLETE":
        return [
          inscribed
            ? `**${typeName}**: » ${inscribed}`
            : `**${typeName}**: ${structure.placement?.examine ?? "it stands here."}`,
          ...noteLines,
        ];
      case "DAMAGED":
        return [`**${typeName}**: it's damaged.`, ...noteLines];
      case "RUINED":
        return [`**${typeName}**: a ruin.`];
      case "ABANDONED":
        return [`**${typeName}**: abandoned.`];
      default:
        return [];
    }
  });
}

// The mining readout is NOT here (db/lib/miningYield.js#qualityWord); the caller prints it first.
function describeLocation(location, ctx = {}) {
  return [
    placementLine(location),
    ...authoredLines(location, ctx),
    ...depotLines(ctx),
    ...structureLines(ctx),
    ...gateLines(ctx.gates),
  ].filter(Boolean);
}

// Pushes a problem for any key not in the registry — silently dropping it means a place never says what it is.
function collectAttributes(raw, label, problems) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    problems.push(`${label} has a non-map attributes:`);
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ATTRIBUTES[key]) {
      problems.push(`${label} has unknown attribute "${key}"`);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function hasAttribute(location, key) {
  const value = location?.attributes?.[key];
  return value != null && value !== false;
}

// One raw form value -> a validated attribute value, per the registry's
// `type`. `undefined` means "leave this key unset" (a false checkbox, a
// blank number/text box) — the same shape collectAttributes' YAML path
// already treats as absent (§ hasAttribute).
function coerceAttributeValue(key, raw) {
  const entry = ATTRIBUTES[key];
  if (!entry) return { error: `Unknown attribute "${key}".` };
  const type = entry.type ?? "boolean";

  if (type === "boolean") {
    return { value: raw ? true : undefined };
  }
  if (type === "number") {
    if (raw === "" || raw == null) return { value: undefined };
    const n = Number(raw);
    if (!Number.isFinite(n)) return { error: `"${key}" must be a number.` };
    return { value: n };
  }
  if (type === "enum") {
    const s = (raw ?? "").toString().trim();
    if (!s) return { value: undefined };
    if (!entry.options?.includes(s)) {
      return { error: `"${key}" must be one of: ${(entry.options ?? []).join(", ")}.` };
    }
    return { value: s };
  }
  // "string"
  const s = (raw ?? "").toString().trim();
  return { value: s || undefined };
}

// The GM form's whole attributes map -> a validated `attributes` JSON blob,
// or the first problem found. `input` is { [key]: rawFormValue }, read only
// for keys the registry knows — an unrecognised key is silently dropped
// here (the caller only ever sends registry keys) rather than rejected the
// way the YAML sync rejects one, since this is driven by the same
// checkboxes/inputs the registry rendered.
function attributesFromInput(input = {}) {
  const attributes = {};
  const problems = [];
  for (const key of Object.keys(ATTRIBUTES)) {
    if (!(key in input)) continue;
    const { value, error } = coerceAttributeValue(key, input[key]);
    if (error) problems.push(error);
    else if (value !== undefined) attributes[key] = value;
  }
  return { attributes, problems };
}

module.exports = {
  GODFLESH_ATTRIBUTE,
  REFINERY_ATTRIBUTE,
  SOILERY_ATTRIBUTE,
  SAFE_ATTRIBUTE,
  WILDERNESS_ATTRIBUTE,
  HAVEN_ATTRIBUTE,
  WHEELS_ATTRIBUTE,
  parksMounts,
  depotLines,
  structureLines,
  ATTRIBUTES,
  authoredLines,
  placementLine,
  gateLines,
  describeLocation,
  collectAttributes,
  hasAttribute,
  coerceAttributeValue,
  attributesFromInput,
};
