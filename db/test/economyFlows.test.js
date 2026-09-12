// The pure shaping in db/lib/economyFlows.js — turning flowsByTurn() rows
// into the two chart shapes the Flows section draws (Sankey, ArcWeb).
const test = require("node:test");
const assert = require("node:assert/strict");
const { sankeyFromFlows, arcWebFromEdges } = require("../lib/economyFlows");

function sortLinks(links) {
  return [...links].sort((a, b) => (a.source + a.target).localeCompare(b.source + b.target));
}

test("sankeyFromFlows: a known row set produces the expected nodes and links", () => {
  const rows = [
    { turnNumber: 1, reason: "LABOR", form: "BALANCE", fromKind: "world", toKind: "character", amount: 10, entryCount: 1 },
    { turnNumber: 1, reason: "LABOR", form: "BALANCE", fromKind: "world", toKind: "character", amount: 5, entryCount: 1 },
    { turnNumber: 1, reason: "HUNGER", form: "BALANCE", fromKind: "character", toKind: "world", amount: 4, entryCount: 1 },
  ];
  const { nodes, links } = sankeyFromFlows(rows);

  const nodeIds = nodes.map((n) => n.id).sort();
  assert.deepEqual(nodeIds, ["bucket:character", "reason:HUNGER", "reason:LABOR"]);

  const labor = nodes.find((n) => n.id === "reason:LABOR");
  assert.equal(labor.column, 0);
  const hunger = nodes.find((n) => n.id === "reason:HUNGER");
  assert.equal(hunger.column, 2);
  const bucket = nodes.find((n) => n.id === "bucket:character");
  assert.equal(bucket.column, 1);

  assert.deepEqual(sortLinks(links), [
    { source: "bucket:character", target: "reason:HUNGER", value: 4 },
    { source: "reason:LABOR", target: "bucket:character", value: 15 },
  ]);
});

test("sankeyFromFlows: TRANSFER and INTERNAL rows are skipped", () => {
  const rows = [
    { reason: "TRANSFER", form: "BALANCE", fromKind: "character", toKind: "character", amount: 10 },
    { reason: "DEPOT_ATM", form: "BALANCE", fromKind: "depot", toKind: "depot", amount: 10 },
  ];
  assert.deepEqual(sankeyFromFlows(rows), { nodes: [], links: [] });
});

test("sankeyFromFlows: zero and negative values are dropped", () => {
  const rows = [
    { reason: "LABOR", fromKind: "world", toKind: "character", amount: 0 },
    { reason: "LABOR", fromKind: "world", toKind: "character", amount: -5 },
  ];
  assert.deepEqual(sankeyFromFlows(rows), { nodes: [], links: [] });
});

test("sankeyFromFlows: no link ever references a node that isn't in the node list", () => {
  const rows = [
    { reason: "LABOR", fromKind: "world", toKind: "character", amount: 10 },
    { reason: "HUNGER", fromKind: "room", toKind: "world", amount: 3 },
    { reason: "UNATTRIBUTED", fromKind: "world", toKind: "unknownKind", amount: 99 },
  ];
  const { nodes, links } = sankeyFromFlows(rows);
  const ids = new Set(nodes.map((n) => n.id));
  for (const l of links) {
    assert.ok(ids.has(l.source), `missing source node ${l.source}`);
    assert.ok(ids.has(l.target), `missing target node ${l.target}`);
  }
});

test("sankeyFromFlows: empty input is empty, not NaN", () => {
  assert.deepEqual(sankeyFromFlows([]), { nodes: [], links: [] });
  assert.deepEqual(sankeyFromFlows(undefined), { nodes: [], links: [] });
});

test("arcWebFromEdges: builds nodes and links from counterparty edges", () => {
  const edges = [
    { fromId: "c1", fromName: "Ada", toId: "c2", toName: "Bo", amount: 12 },
    { fromId: "c1", fromName: "Ada", toId: "c2", toName: "Bo", amount: 3 },
  ];
  const { nodes, links } = arcWebFromEdges(edges);
  assert.deepEqual(
    nodes.slice().sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "c1", label: "Ada" },
      { id: "c2", label: "Bo" },
    ],
  );
  assert.deepEqual(links, [
    { source: "c1", target: "c2", value: 12 },
    { source: "c1", target: "c2", value: 3 },
  ]);
});

test("arcWebFromEdges: drops self-links and zero values", () => {
  const edges = [
    { fromId: "c1", fromName: "Ada", toId: "c1", toName: "Ada", amount: 5 },
    { fromId: "c1", fromName: "Ada", toId: "c2", toName: "Bo", amount: 0 },
  ];
  assert.deepEqual(arcWebFromEdges(edges), { nodes: [], links: [] });
});

test("arcWebFromEdges: empty input is empty", () => {
  assert.deepEqual(arcWebFromEdges([]), { nodes: [], links: [] });
  assert.deepEqual(arcWebFromEdges(undefined), { nodes: [], links: [] });
});
