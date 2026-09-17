// The Examine readout: what can be worked here, what the place IS, and what
// the ways out are doing. One composer, so the anchor's Examine button and
// Chat's Examine dialog answer the same three questions in the same order.
//
// Information only — it files nothing, costs nothing, and is deliberately
// readable by anyone standing here whether or not they hold a Laboring tag.
// Scouting a place is the point, and a scout reporting back to a hunter is a
// conversation the game wants.
const { qualityWord } = require("./laborYield");
const { linksFor, endpoints } = require("./locationGraph");
const { describeLocation, hasAttribute } = require("./locationAttributes");
const { loadDepot } = require("./depotState");
const { isArrivalTurn } = require("./train");
const { structuresAt } = require("./structures");

// Fixed order, so the readout looks the same everywhere and a player can
// learn the shape rather than reading the labels every time.
const LABOR_QUERY_KINDS = [
  { kind: "HUNTING", label: "Hunting" },
  { kind: "FARMING", label: "Farming" },
  { kind: "FISHING", label: "Fishing" },
  { kind: "PROSPECTING", label: "Prospecting" },
];

// Returns { ok: true, name, lines } or { ok: false, error }. `lines` is
// plain text — whichever face is asking adds its own `»` or its own markup.
async function examineLines(prisma, locationId) {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: {
      name: true,
      indoors: true,
      attributes: true,
      yields: { select: { kind: true, current: true } },
    },
  });
  if (!location) return { ok: false, error: "That place is gone." };

  // The gate state is read through the graph rather than off any button,
  // because a GM can flip an edge without anyone refreshing a message and
  // Examine must never be the stale one.
  const links = await linksFor(prisma, locationId);
  const gates = links
    .filter((link) => link.modular)
    .map((link) => ({ isOpen: link.isOpen, farName: endpoints(link, locationId).far.name }));

  // No row means that labor is impossible here (LABORING.md §3), so it is
  // left off the line entirely rather than printed as a permanent ×. A row
  // that has drifted to 0 still prints — that is a place worth checking back
  // on, not one that can never pay.
  const byKind = new Map(location.yields.map((row) => [row.kind, row.current]));
  const laborLine = LABOR_QUERY_KINDS.filter(({ kind }) => byKind.has(kind))
    .map(({ kind, label }) => `**${label}**: ${qualityWord(byKind.get(kind))}`)
    .join(" | ");

  // The Depot's machinery and anything standing on the ground are LIVE state,
  // so they are loaded here and handed to describeLocation as ctx rather than
  // being authored on the Location.
  let depot = null;
  if (hasAttribute(location, "depot")) {
    const [row, openTurn] = await Promise.all([
      loadDepot(prisma),
      prisma.turn.findFirst({ where: { closedAt: null }, orderBy: { number: "desc" }, select: { number: true } }),
    ]);
    depot = {
      turretArmed: row.turretArmed,
      trainHere: isArrivalTurn(openTurn?.number ?? 0),
    };
  }
  const structures = await structuresAt(prisma, locationId);

  return {
    ok: true,
    name: location.name,
    // A place with no LocationYield rows at all (Town) has nothing to say
    // here — dropped rather than printed as an empty line, same as every
    // other part of this readout that has nothing to say.
    lines: [...(laborLine ? [laborLine] : []), ...describeLocation(location, { gates, depot, structures })],
  };
}

module.exports = {
  examineLines,
};
