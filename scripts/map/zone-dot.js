#!/usr/bin/env node
// docs/zones.yaml -> a Graphviz .dot: one cluster per zone, one node per
// Location, one edge per `connections:` entry, styled for whatever actually
// gates the crossing.
//
//   npm run map:dot                 write zone.dot at the repo root
//   npm run map:dot -- out.dot      write somewhere else
//
//   dashed    = on_foot (no horse/cart/boat fits) — wins over dotted below
//   dotted    = hidden and NOT on_foot
//   bold      = modular (a gate with a winch)
//   gray      = hidden
//   dark cyan = a Fishing Boat's extra crossing works here (WATER_ZONE_SLUGS,
//               db/lib/mounts.js)
//   blue      = crosses a zone otherwise, so the hop costs the Move
//   label     = whatever locked/hidden/announce/keyed the edge
//
// Each node's label also carries its `mining:` coefficient (MINING.md §2);
// a Location with no row at all carries nothing, because it cannot be dug.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const ZONES_PATH = path.join(ROOT, "docs", "zones.yaml");

const MINING_EMOJI = "⛏️";

// Mirrors db/lib/mounts.js#WATER_ZONE_SLUGS as its own small copy — this
// reads docs/zones.yaml, not the game's runtime state.
const WATER_ZONES = new Set(["forest", "hills", "marshes"]);

// `kind: group` zones (Underground) never appear in connections themselves —
// only their `levels:` do, each a real zone id. Flatten them here so the
// returned map is keyed exactly how connections addresses them (SYNC.md).
function collectZones(doc) {
  const zones = new Map(); // zoneId -> { name, locations: Map<locId, { name, yield }> }
  for (const [zoneId, zone] of Object.entries(doc.zones ?? {})) {
    if (zone.kind === "group") {
      for (const [levelId, level] of Object.entries(zone.levels ?? {})) {
        zones.set(levelId, { name: level.name, locations: collectLocations(level) });
      }
      continue;
    }
    zones.set(zoneId, { name: zone.name, locations: collectLocations(zone) });
  }
  return zones;
}

function collectLocations(zoneOrLevel) {
  const locations = new Map();
  for (const [locId, loc] of Object.entries(zoneOrLevel.locations ?? {})) {
    locations.set(locId, { name: loc.name, mining: loc.mining ?? null, indoors: Boolean(loc.indoors) });
  }
  return locations;
}

function miningLabel(mining) { // a Location with no coefficient carries no line
  return mining == null ? null : `${MINING_EMOJI} ${mining}`;
}

function collectEdges(doc) { // one normalized shape, bare pair or a mapping with `pair:`
  return (doc.connections ?? []).map((entry) => {
    const isBare = Array.isArray(entry);
    const [a, b] = isBare ? entry : entry.pair;
    return {
      a,
      b,
      onFoot: !isBare && Boolean(entry.on_foot),
      modular: !isBare && Boolean(entry.modular),
      keyed: !isBare && Boolean(entry.keyed),
      locked: isBare ? null : (entry.locked ?? null),
      hidden: isBare ? null : (entry.hidden ?? null),
      announce: isBare ? null : (entry.announce ?? null),
    };
  });
}

function dotId(slug) {
  return JSON.stringify(slug); // quoted, so the "/" in a slug is fine
}

function edgeAttrs(edge) {
  const zoneA = edge.a.split("/")[0];
  const zoneB = edge.b.split("/")[0];
  const crossesZone = zoneA !== zoneB;
  const boatWater = !edge.onFoot && WATER_ZONES.has(zoneA) && WATER_ZONES.has(zoneB);

  const style = []; // on_foot always draws dashed, even on a hidden edge
  if (edge.onFoot) style.push("dashed");
  else if (edge.hidden) style.push("dotted");
  if (edge.modular) style.push("bold");

  const label = [];
  if (edge.locked) label.push(`locked: ${edge.locked}`);
  if (edge.hidden) label.push(`hidden: ${edge.hidden}`);
  if (edge.announce) label.push(`announce: ${edge.announce}`);
  if (edge.keyed) label.push("keyed");

  const attrs = [];
  if (style.length) attrs.push(`style="${style.join(",")}"`);
  const color = edge.hidden ? "gray45" : boatWater ? "darkcyan" : crossesZone ? "steelblue" : "black";
  attrs.push(`color="${color}"`);
  if (boatWater || crossesZone) attrs.push("penwidth=1.6");
  if (label.length) attrs.push(`label=${JSON.stringify(label.join("\n"))}`); // real newline; JSON.stringify escapes it to DOT's \n
  return ` [${attrs.join(", ")}]`;
}

// Light fills only — every node inside is forced to a solid white box below,
// so a cluster tint can never eat into label contrast.
const ZONE_FILL = {
  town: "#fdf6d3",
  fortress: "#e9def2",
  forest: "#deefe0",
  hills: "#ece1cb",
  marshes: "#dbe9f5",
  caves: "#e4e4e4",
  depths: "#c8ccd6",
};

// A standalone HTML-like label rather than literal legend edges — a table
// gives every row equal weight for free, and style/color stay two lists
// since they're independent channels (a dashed edge can be black or gray).
function legendLines() {
  const row = (glyph, glyphColor, text) =>
    `<TR><TD ALIGN="LEFT"><FONT COLOR="${glyphColor}">${glyph}</FONT></TD>` +
    `<TD ALIGN="LEFT">${text}</TD></TR>`;
  const table = [
    '<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="3" CELLPADDING="1">',
    '<TR><TD COLSPAN="2"><B>Line style</B></TD></TR>',
    row("──────", "black", "Open road"),
    row("╌ ╌ ╌ ╌", "black", "On foot — no horse, cart or boat fits"),
    row("· · · · · · ·", "black", "Hidden only — and not on foot"),
    row("━━━━━━", "black", "Modular gate — a winch, shut or open"),
    '<TR><TD COLSPAN="2"> </TD></TR>',
    '<TR><TD COLSPAN="2"><B>Line color</B></TD></TR>',
    row("──────", "black", "Ordinary crossing"),
    row("──────", "steelblue", "Crosses a zone — costs the Move"),
    row("──────", "darkcyan", "A Fishing Boat's extra crossing works here"),
    row("──────", "gray45", "Hidden — always this color, dashed or not"),
    '<TR><TD COLSPAN="2"> </TD></TR>',
    '<TR><TD COLSPAN="2"><B>Location border</B></TD></TR>',
    // Real nested box-in-a-box, matching the peripheries=2 double border.
    '<TR><TD ALIGN="LEFT"><TABLE BORDER="1" CELLBORDER="1" CELLSPACING="2" CELLPADDING="6"><TR><TD></TD></TR></TABLE></TD>' +
      '<TD ALIGN="LEFT">Indoors — a mount/cart/boat is parked at the door</TD></TR>',
    "</TABLE>",
  ].join("");
  return [
    '  subgraph cluster_legend {',
    '    label="Legend";',
    "    style=filled;",
    '    fillcolor="white";',
    '    fontname=Helvetica;',
    `    legend [shape=none, margin=0, fontname=Helvetica, label=<${table}>];`,
    "  }",
  ];
}

function buildDot(zones, edges) {
  // Nodes with at least one edge to another node in the SAME zone.
  const clustered = new Set();
  for (const edge of edges) {
    if (edge.a.split("/")[0] === edge.b.split("/")[0]) {
      clustered.add(edge.a);
      clustered.add(edge.b);
    }
  }

  const lines = [
    "// Generated by scripts/map/zone-dot.js from docs/zones.yaml — do not hand-edit.",
    "graph zones {",
    "  rankdir=LR;",
    '  node [shape=box, style="rounded,filled", fillcolor=white, fontname=Helvetica];',
    "",
  ];
  const loose = [];

  for (const [zoneId, zone] of zones) {
    lines.push(`  subgraph "cluster_${zoneId}" {`);
    lines.push(`    label=${JSON.stringify(zone.name)};`);
    lines.push("    style=filled;");
    lines.push(`    fillcolor="${ZONE_FILL[zoneId] ?? "white"}";`);
    for (const [locId, loc] of zone.locations) {
      const fullId = `${zoneId}/${locId}`;
      const yieldLine = miningLabel(loc.mining);
      const label = yieldLine ? `${loc.name}\n${yieldLine}` : loc.name;
      const peripheries = loc.indoors ? ", peripheries=2" : ""; // double border, not a color or word
      const nodeLine = `${dotId(fullId)} [label=${JSON.stringify(label)}${peripheries}];`;
      if (clustered.has(fullId)) lines.push(`    ${nodeLine}`);
      else loose.push(`  ${nodeLine}`);
    }
    lines.push("  }");
  }
  lines.push(...loose);
  lines.push("");

  for (const edge of edges) {
    lines.push(`  ${dotId(edge.a)} -- ${dotId(edge.b)}${edgeAttrs(edge)};`);
  }
  lines.push("", ...legendLines());

  lines.push("}");
  return lines.join("\n") + "\n";
}

// The pure read-YAML-to-dot-text step, exported so zone-image.js can render
// straight from it without re-reading a .dot that might be stale.
function generateDot() {
  const doc = yaml.load(fs.readFileSync(ZONES_PATH, "utf8"));
  const zones = collectZones(doc);
  const edges = collectEdges(doc);
  return { dot: buildDot(zones, edges), zoneCount: zones.size, edgeCount: edges.length };
}

function main() {
  const outPath = path.resolve(process.argv[2] ?? path.join(ROOT, "zone.dot"));
  const { dot, zoneCount, edgeCount } = generateDot();
  fs.writeFileSync(outPath, dot);
  console.log(`${edgeCount} edges, ${zoneCount} zones -> ${path.relative(ROOT, outPath)}`);
}

if (require.main === module) main();

module.exports = { generateDot, ROOT };
