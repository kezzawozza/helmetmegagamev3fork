// Who is standing at a Location, shared by the "Who's here?" button and
// Chat's people column. Names, plus the ESTATE a name is painted in — a role
// TITLE is still private, and no player ever reads another's off this list (the
// GM readout below is the one place it appears), but which of the six coloured
// groups somebody belongs to is public by design (db/lib/roleGroups.js), and
// the two buckets that are not coloured are exactly the ones holding every seat
// a look may not read. Concealed characters come back separately. A forced
// name (Tag.forcedName) outranks a real one and never joins the concealed list.
const { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom, presentedIdentity } = require("./presentedIdentity");
const { aliasRow } = require("./concealedIdentity");
const { lastSightings } = require("./sightings");
const { hoodToken } = require("./hoodToken"); // its own leaf to avoid a require cycle; re-exported below.
const { roleGroupHue } = require("./roleGroups");

const PRESENT_SELECT = {
  id: true,
  name: true,
  // GM-only: whosHereGm() below is the one reader. namedRows() never touches it.
  roleTitle: true,
  // The group, unlike the title, does reach a player — as the colour their name
  // is drawn in. roleGroupHue() decides which groups have one.
  role: { select: { groupSlug: true } },
  concealed: true,
  status: true,
  buriedAt: true,
  // What was over the face at the moment of death (Character.deathMaskTagId).
  // A corpse wears nothing — death unequips — so the living rule below would
  // name every masked body the moment it hit the floor.
  deathMaskTagId: true,
  age: true,
  gender: true,
  updatedAt: true,
  lastSeenAt: true,
  tags: {
    // Every concealing piece, equipped or not, rather than only the worn ones:
    // a corpse's remembered mask is by definition no longer in its slot, and
    // concealmentFrom() goes on ignoring the unequipped for everybody alive.
    where: {
      OR: [{ tag: { forcedName: { not: null } } }, { tag: { concealsIdentity: true } }],
    },
    select: { tagId: true, equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
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

// What a dead body still has over its face, or null. The remembered tag has to
// be BOTH stamped and still held — a dangling id (the catalog pruned it, or
// somebody walked off with the helmet) reads as a bare face, which is the safe
// direction and the one that makes looting a mask off mean something.
function deathMaskPiece(row) {
  if (!row?.deathMaskTagId || !Array.isArray(row.tags)) return null;
  const held = row.tags.find((ct) => ct.tagId === row.deathMaskTagId);
  const tag = held?.tag;
  if (!tag?.concealsIdentity || !tag?.concealSprite) return null;
  // No `forced`: it means "a sack you cannot take off", and the dead branch
  // below decides hidden on the death mask's presence alone, so nothing would
  // read it. A field nothing reads is a field somebody trusts wrongly later.
  return { sprite: tag.concealSprite, name: tag.name ?? null, tagId: row.deathMaskTagId };
}

// The one place "is this person hidden from this viewer" is decided; every
// readout and resolveHoodToken read it rather than asking again. `sightings`
// is a caller's own lastSightings Map; without one, `withSightings` decides whether to go and ask.
async function presentRows(
  prisma,
  viewer,
  { locationId, includeSelf = true, includeDead = false, withSightings = false, sightings = null } = {},
) {
  const where = locationId ?? viewer?.locationId ?? null;
  if (!where) return [];

  const present = await prisma.character.findMany({
    // `includeDead` adds the UNBURIED dead, for the verbs that act on a body
    // (Loot, Engrave, Bury, Butcher). A buried one is out of the world and is
    // never here, the same rule hereWhere() keeps.
    where: {
      locationId: where,
      ...(includeDead
        ? { OR: [{ status: "ALIVE" }, { status: "DEAD", buriedAt: null }] }
        : { status: "ALIVE" }),
    },
    select: PRESENT_SELECT,
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
  });

  const seenBy = sightings ?? (withSightings ? await lastSightings(prisma, viewer) : new Map());

  // Concealed the same way the proxy decides it, not straight off the column.
  return present
    .filter((c) => includeSelf || c.id !== viewer?.id)
    .map((c) => {
      const dead = c.status === "DEAD";
      // A corpse wears nothing — death unequips — so concealmentFrom() answers
      // null for one however it died. What it wore is remembered instead
      // (Character.deathMaskTagId), and still DERIVED rather than trusted: the
      // mask counts only while the body also still HOLDS it, so looting the
      // helmet off unmasks the corpse with no second write anywhere.
      const deathPiece = dead ? deathMaskPiece(c) : null;
      const piece = deathPiece ?? concealmentFrom(c.tags);
      const forced = forcedNameFrom(c.tags);
      const live = dead ? Boolean(deathPiece) : Boolean(piece && (piece.forced || c.concealed));
      const self = c.id === viewer?.id;
      const sighting = self ? null : (seenBy.get(c.id) ?? null); // you have always seen yourself.
      const seen = self || Boolean(sighting);
      // A forced name is not hiding (PROXYING.md §5), so it never moves lists.
      const hidden = forced ? false : sighting ? sighting.concealed : live;
      return { ...c, forced, hidden, seen, sighting, self, livePiece: piece };
    });
}

// `viewer` needs { id?, locationId } — id keeps the looker out of
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
      return {
        characterId: c.id,
        name: c.forced ?? c.sighting?.name ?? c.name, // the name you HOLD.
        avatarVersion: c.updatedAt?.getTime?.() ?? null,
        // A forced name wears its letter plaque, never the face behind it.
        avatarPath: c.forced ? presentedIdentity(c, { forcedName: c.forced }).avatarPath : (c.sighting?.avatarPath ?? null),
        unknownFace: false,
        seen: c.seen,
        sightingSeq: c.sighting?.seq ?? null,
        self: c.self,
        online: isOnline(c.lastSeenAt),
        // Filtered HERE rather than in the browser, so an Outsider's bucket
        // never leaves the server at all. Null under a forced name: the name on
        // the row is not theirs, and painting it in their own estate would hand
        // back exactly what the Disguise Kit took away — the feed already hoods
        // a forced-name line (db/lib/archive.js#feedRowShape), and the two
        // lists have to agree.
        roleGroup: c.forced ? null : roleGroupHue(c.role?.groupSlug),
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

// WHO IS ACTUALLY STANDING THERE, for a GM: no sightings and no hood tokens.
// The role title is here and nowhere else — a GM reads it, a player never does.
// `presentedAs` is the alias the room sees, the one thing the player list can never tell them.
async function whosHereGm(prisma, locationId) {
  if (!locationId) return [];
  const rows = await presentRows(prisma, null, { locationId });
  return rows.map((c) => ({
    characterId: c.id,
    name: c.name,
    roleTitle: c.roleTitle ?? null,
    presentedAs: c.forced ?? (c.hidden ? aliasRow(c, null) : null), // forced name is not a hood (PROXYING.md §5).
    avatarVersion: c.updatedAt?.getTime?.() ?? null,
    online: isOnline(c.lastSeenAt),
  }));
}

// Which concealed character at the VIEWER's Location the token names, or
// null. Reads presentRows() rather than deciding for itself, so it can never disagree with the list that minted it.
async function resolveHoodToken(prisma, viewer, token, { sightings = null, includeDead = false } = {}) {
  if (!token || !viewer?.locationId) return null;
  // No key, no answer — the same reason hoodToken() above mints none.
  if (!process.env.AUTH_SECRET) return null;
  // `includeDead` is the CALLER's business, and it has to be, because it is the
  // verb that knows whether a body is a legal target: Loot allows one, Heal
  // does not. Off by default, so a token minted over a corpse resolves to
  // nobody for every verb that never asked for one.
  const rows = await presentRows(prisma, viewer, { withSightings: true, sightings, includeDead });
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
    lines.push(`**Here:** ${named.map((c) => c.name).join(" | ")}`);
  }
  if (concealed.length > 0) lines.push(`**Also here:** ${concealed.map((c) => c.alias).join(" | ")}`);
  for (const group of across) {
    const people = [
      ...group.named.map((c) => c.name),
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
