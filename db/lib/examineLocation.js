// The Examine readout: what can be worked here, what the place IS, and what
// the ways out are doing. One composer, so the anchor's Examine button and
// Chat's Examine dialog answer the same three questions in the same order.
//
// Information only — it files nothing, costs nothing, and is deliberately
// readable by anyone standing here whether or not they hold Prospecting.
// Scouting a place is the point, and a scout reporting back to a digger is a
// conversation the game wants.
const { qualityWord } = require("./miningYield");
const { linksFor, endpoints } = require("./locationGraph");
const { describeLocation, hasAttribute } = require("./locationAttributes");
const { loadDepot } = require("./depotState");
const { trainHere } = require("./train");
const { structuresAt } = require("./structures");

// Returns { ok: true, name, lines } or { ok: false, error }. `lines` is
// plain text — whichever face is asking adds its own `»` or its own markup.
async function examineLines(prisma, locationId) {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: {
      name: true,
      indoors: true,
      attributes: true,
      mining: { select: { current: true } },
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

  // No row means you cannot dig here at all (MINING.md §3), so the line is
  // left off entirely rather than printed as a permanent ×. A row that has
  // drifted to 0 still prints — that is a place worth checking back on, not
  // one that can never pay.
  const miningLine = location.mining
    ? `**Mining**: ${qualityWord(location.mining.current)}`
    : null;

  // The Depot's machinery and anything standing on the ground are LIVE state,
  // so they are loaded here and handed to describeLocation as ctx rather than
  // being authored on the Location.
  let depot = null;
  if (hasAttribute(location, "depot")) {
    const [row, openTurn] = await Promise.all([
      loadDepot(prisma),
      prisma.turn.findFirst({ where: { status: "OPEN" }, orderBy: { number: "desc" }, select: { number: true } }),
    ]);
    depot = {
      turretArmed: row.turretArmed,
      trainHere: trainHere(openTurn?.number ?? 0),
    };
  }
  const structures = await structuresAt(prisma, locationId);

  return {
    ok: true,
    name: location.name,
    // A place with no LocationMining row at all (Town) has nothing to say
    // here — dropped rather than printed as an empty line, same as every
    // other part of this readout that has nothing to say.
    lines: [...(miningLine ? [miningLine] : []), ...describeLocation(location, { gates, depot, structures })],
  };
}

module.exports = {
  examineLines,
};
