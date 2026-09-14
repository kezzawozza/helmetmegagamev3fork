// Who is standing at a Location, shared by the "Who's here?" button and
// Chat's people column. Named first, Role only for a fellow member of a REAL
// faction (FACTIONS.md §4a). Concealed characters come back separately. A
// forced name (Tag.forcedName) outranks both: `named` with NO role, and never in the concealed list.
const { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom, presentedIdentity } = require("./presentedIdentity");
const { aliasRow } = require("./concealedIdentity");
const { isUnaffiliated } = require("./factionConstants");
const { lastSightings } = require("./sightings");
const { hoodToken } = require("./hoodToken"); // its own leaf to avoid a require cycle; re-exported below.

const PRESENT_SELECT = {
  id: true,
  name: true,
  roleTitle: true,
  factionId: true,
  concealed: true,
  age: true,
  gender: true,
  updatedAt: true,
  lastSeenAt: true,
  faction: { select: { name: true, slug: true } },
  tags: {
    where: {
      OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
    },
    select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
  },
};

// The "online" badge's window — used the website or sent a Discord message
// in the last hour (Character.lastSeenAt, db/lib/characterActivity.js
// #touchLastSeen). Named rows only: a concealed/hooded person already
// deliberately withholds every identity-linked signal, and this one is no
// exception.
const ONLINE_WINDOW_MS = 60 * 60_000;
function isOnline(lastSeenAt, now = Date.now()) {
  return Boolean(lastSeenAt) && now - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

// The one place "is this person hidden from this viewer" is decided; every
// readout and resolveHoodToken read it rather than asking again. `sightings`
// is a caller's own lastSightings Map; without one, `withSightings` decides whether to go and ask.
async function presentRows(
  prisma,
  viewer,
  { locationId, includeSelf = true, withSightings = false, sightings = null } = {},
) {
  const where = locationId ?? viewer?.locationId ?? null;
  if (!where) return [];

  const present = await prisma.character.findMany({
    where: { status: "ALIVE", locationId: where },
    select: PRESENT_SELECT,
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
  });

  const seenBy = sightings ?? (withSightings ? await lastSightings(prisma, viewer) : new Map());

  // Concealed the same way the proxy decides it, not straight off the column.
  return present
    .filter((c) => includeSelf || c.id !== viewer?.id)
    .map((c) => {
      const piece = concealmentFrom(c.tags);
      const forced = forcedNameFrom(c.tags);
      const live = Boolean(piece && (piece.forced || c.concealed));
      const self = c.id === viewer?.id;
      const sighting = self ? null : (seenBy.get(c.id) ?? null); // you have always seen yourself.
      const seen = self || Boolean(sighting);
      // A forced name is not hiding (PROXYING.md §5), so it never moves lists.
      const hidden = forced ? false : sighting ? sighting.concealed : live;
      return { ...c, forced, hidden, seen, sighting, self, livePiece: piece };
    });
}

// `viewer` needs { id?, factionId, locationId } — id keeps the looker out of
// their own list, which the Discord readout never did. `withSightings` gates
// the FACE and the eye (db/lib/sightings.js): on, a sighting REPLACES the live identity rather than decorating it.
async function whosHere(prisma, viewer, { withHoodIds = false, withAcross = false, ...options } = {}) {
  const sightings =
    options.sightings ?? (options.withSightings ? await lastSightings(prisma, viewer) : null);
  const rows = await presentRows(prisma, viewer, { ...options, sightings });

  const named = namedRows(rows, viewer);
  const concealed = concealedRows(rows, { withTokens: true });

  // Across a modular gate: listed, but rows nothing can act on — no token on a
  // hood, and never in hoodIds below. Opt-in, so no picker can offer them.
  const result = { named, concealed };
  if (withAcross) {
    const locationId = options.locationId ?? viewer?.locationId ?? null;
    result.across = [];
    for (const far of await gateNeighbours(prisma, locationId)) {
      const farRows = await presentRows(prisma, viewer, { locationId: far.id, sightings: sightings ?? new Map() });
      result.across.push({
        locationId: far.id,
        locationName: far.name,
        named: namedRows(farRows, viewer),
        concealed: concealedRows(farRows, { withTokens: false }),
      });
    }
  }

  // SERVER-ONLY, opt-in: token -> character id, for placeMembers() to filter hoods before offering them.
  // Not an id on the concealed rows themselves — shipping one IS the unmasking.
  if (!withHoodIds) return result;
  const hoodIds = new Map();
  for (const c of rows) {
    if (c.hidden && !c.forced) hoodIds.set(hoodToken(c.id), c.id);
  }
  return { ...result, hoodIds };
}

// Locations across a modular gate, read straight off the links (avoids a require cycle with locationGraph.js).
async function gateNeighbours(prisma, locationId) {
  if (!locationId) return [];
  const links = await prisma.locationLink.findMany({
    where: { modular: true, OR: [{ aId: locationId }, { bId: locationId }] },
    select: { aId: true, a: { select: { id: true, name: true } }, b: { select: { id: true, name: true } } },
  });
  return links.map((link) => (link.aId === locationId ? link.b : link.a)).filter(Boolean);
}

function namedRows(rows, viewer) {
  return rows
    .filter((c) => !c.hidden || c.forced)
    .map((c) => {
      const sameFaction =
        viewer?.factionId && c.factionId === viewer.factionId && !isUnaffiliated(c.faction) && c.roleTitle;
      return {
        characterId: c.id,
        name: c.forced ?? c.sighting?.name ?? c.name, // the name you HOLD.
        roleTitle: c.forced ? null : sameFaction ? c.roleTitle : null,
        avatarVersion: c.updatedAt?.getTime?.() ?? null,
        // A forced name wears its letter plaque, never the face behind it.
        avatarPath: c.forced ? presentedIdentity(c, { forcedName: c.forced }).avatarPath : (c.sighting?.avatarPath ?? null),
        unknownFace: false,
        seen: c.seen,
        sightingSeq: c.sighting?.seq ?? null,
        self: c.self,
        online: isOnline(c.lastSeenAt),
      };
    });
}

function concealedRows(rows, { withTokens }) {
  return rows
    .filter((c) => c.hidden && !c.forced)
    .map((c) => {
      // What is over the face — the sprite says WHAT, never who (PROXYING.md §5) —
      // but only once you have watched them speak in it; unseen wears the question-mark plate.
      const face = c.self
        ? presentedIdentity(c, { concealment: c.livePiece }).avatarPath
        : (c.sighting?.avatarPath ?? null);
      return {
        alias: aliasRow(c, c.sighting?.name),
        token: withTokens ? hoodToken(c.id) : null,
        avatarPath: c.seen ? face : null,
        unknownFace: !c.seen || Boolean(c.sighting?.unknownFace),
        seen: c.seen,
        sightingSeq: c.sighting?.seq ?? null,
      };
    });
}

// WHO IS ACTUALLY STANDING THERE, for a GM: no sightings, no hood tokens, no
// faction gate. `presentedAs` is the alias the room sees, the one thing the player list can never tell them.
async function whosHereGm(prisma, locationId) {
  if (!locationId) return [];
  const rows = await presentRows(prisma, null, { locationId });
  return rows.map((c) => ({
    characterId: c.id,
    name: c.name,
    roleTitle: c.roleTitle ?? null,
    factionName: isUnaffiliated(c.faction) ? null : (c.faction?.name ?? null),
    presentedAs: c.forced ?? (c.hidden ? aliasRow(c, null) : null), // forced name is not a hood (PROXYING.md §5).
    avatarVersion: c.updatedAt?.getTime?.() ?? null,
    online: isOnline(c.lastSeenAt),
  }));
}

// Which concealed character at the VIEWER's Location the token names, or
// null. Reads presentRows() rather than deciding for itself, so it can never disagree with the list that minted it.
async function resolveHoodToken(prisma, viewer, token, { sightings = null } = {}) {
  if (!token || !viewer?.locationId) return null;
  // No key, no answer — the same reason hoodToken() above mints none.
  if (!process.env.AUTH_SECRET) return null;
  const rows = await presentRows(prisma, viewer, { withSightings: true, sightings });
  for (const c of rows) {
    if (!c.hidden || c.forced) continue;
    if (hoodToken(c.id) === token) return c.id;
  }
  return null;
}

// The Discord button's readout, built off the same rows so the channel and the page can never disagree.
function whosHereLines({ named, concealed, across = [] }) {
  const lines = [];
  if (named.length > 0) {
    lines.push(`**Here:** ${named.map((c) => (c.roleTitle ? `${c.name}, ${c.roleTitle}` : c.name)).join(" | ")}`);
  }
  if (concealed.length > 0) lines.push(`**Also here:** ${concealed.map((c) => c.alias).join(" | ")}`);
  for (const group of across) {
    const people = [
      ...group.named.map((c) => (c.roleTitle ? `${c.name}, ${c.roleTitle}` : c.name)),
      ...group.concealed.map((c) => c.alias),
    ];
    if (people.length > 0) lines.push(`**${group.locationName}:** ${people.join(" | ")}`);
  }
  return lines;
}

module.exports = {
  PRESENT_SELECT,
  whosHere,
  whosHereGm,
  whosHereLines,
  resolveHoodToken,
  hoodToken,
  ONLINE_WINDOW_MS,
  isOnline,
};
