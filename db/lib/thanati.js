// The Thanati as a cult rather than a seat: who is one, who leads, where the
// hideout is, what the network sells, and the roster line Recall Comrades
// sends (docs/systemdocs/THANATI.md). The seats themselves are in
// db/lib/threats.js; the rites in db/lib/rites.js.
//
// Takes `db` as a parameter where it queries, the db/lib/dm.js convention.

const THANATI_SLUG = "thanati";
const THANATI_LEADER_SLUG = "thanati-leader";
const BLACK_ROBES_SLUG = "black-robes";
const THANATI_MASK_SLUG = "thanati-mask";
const DARK_INSPIRATION_SLUG = "dark-inspiration";
const SHIMMERING_ROBES_SLUG = "shimmering-robes";
const SCRYING_EYE_SLUG = "scrying-eye";
const GHOUL_SLUG = "ghoul";
const SERVANT_SLUG = "servant-of-tzchernobog";
const RAGE_SLUG = "rage";

// What counts as "wearing the robes" for a chant: the plain ones, or the
// Rite of Reflection's imbued pair.
const ROBE_SLUGS = Object.freeze([BLACK_ROBES_SLUG, SHIMMERING_ROBES_SLUG]);

// What Recover Equipment hands back: whichever of these the cultist is not
// holding.
const RECOVERABLE_SLUGS = Object.freeze([BLACK_ROBES_SLUG, THANATI_MASK_SLUG]);

// The network's shelf. ONE price per ware, not two: an obol is one ⬢
// everywhere else in the game (DEPOT.md), the two columns here were always
// equal, and the shelf now takes both currencies in the same purchase, so a
// split price would have had no meaning anyway. Bascinet's numbers.
//
// This list is also what "Thanati equipment" means for the Black Robes'
// combat line.
const THANATI_WARES = Object.freeze([
  { slug: "stack-of-paper", price: 3 },
  { slug: "black-robes", price: 3 },
  { slug: "instant-camera", price: 3 },
  { slug: "sacrificial-knife", price: 4 },
  { slug: "dagger", price: 6 },
  { slug: "thanati-mask", price: 10 },
  { slug: "radio-27065", price: 20 },
  { slug: "adders-bite", price: 30 },
  { slug: "dynamite-stick", price: 30 },
  { slug: "poison-tooth", price: 40 },
  { slug: "sawn-off-double-barrel", price: 45 },
  { slug: "dynamite-bundle", price: 160 },
]);

const OBOL_SLUG = "obol";

// A roster join glyph shared with the torture reveal (db/lib/torture.js).
const BULLET = " • ";

function isThanati(heldSlugs) {
  return heldSlugs.has(THANATI_SLUG);
}

function isThanatiLeader(heldSlugs) {
  return heldSlugs.has(THANATI_LEADER_SLUG);
}

// Every living cultist, the leader first, then by name. `roleTitle` is the
// character's own role name as shown on their sheet.
async function listComrades(db) {
  const rows = await db.character.findMany({
    where: { status: "ALIVE", tags: { some: { tag: { slug: THANATI_SLUG } } } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      roleTitle: true,
      role: { select: { name: true } },
      tags: { where: { tag: { slug: THANATI_LEADER_SLUG } }, select: { id: true } },
    },
  });
  return rows
    .map((c) => ({ id: c.id, name: c.name, role: c.roleTitle ?? c.role?.name ?? "", leader: c.tags.length > 0 }))
    .sort((a, b) => Number(b.leader) - Number(a.leader) || a.name.localeCompare(b.name));
}

// "Your comrades are: Ash, Baron [LEADER] • Wren, Servant". Bascinet's shape.
function formatComrades(rows) {
  const parts = rows.map((r) => `${r.name}, ${r.role}${r.leader ? " [LEADER]" : ""}`);
  return `Your comrades are: ${parts.join(BULLET)}`;
}

// The hideout Room, or null when unset or when the room it pointed at is gone
// (a zone sync recreates rooms; the pointer is a snapshot id on purpose).
async function hideoutRoom(db) {
  const state = await db.gameState.findUnique({ where: { id: 1 }, select: { thanatiHideoutRoomId: true } });
  if (!state?.thanatiHideoutRoomId) return null;
  return db.room.findUnique({
    where: { id: state.thanatiHideoutRoomId },
    // `kind` and `accessTagSlugs` ride along for accessibleRooms: Purchase
    // Gear checks the BUYER's key against this room, not just their Location.
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      accessTagSlugs: true,
      locationId: true,
      discordThreadId: true,
      resources: true,
    },
  });
}

// Robed AND Inspired: the two facts that make a chant count. One query.
async function chanterReady(db, characterId) {
  const rows = await db.characterTag.findMany({
    where: { characterId, quantity: { gt: 0 }, tag: { slug: { in: [...ROBE_SLUGS, DARK_INSPIRATION_SLUG] } } },
    select: { equipped: true, tag: { select: { slug: true } } },
  });
  const robed = rows.some((r) => ROBE_SLUGS.includes(r.tag.slug) && r.equipped);
  const inspired = rows.some((r) => r.tag.slug === DARK_INSPIRATION_SLUG);
  return robed && inspired;
}

module.exports = {
  THANATI_SLUG,
  THANATI_LEADER_SLUG,
  SHIMMERING_ROBES_SLUG,
  SCRYING_EYE_SLUG,
  GHOUL_SLUG,
  SERVANT_SLUG,
  RAGE_SLUG,
  ROBE_SLUGS,
  RECOVERABLE_SLUGS,
  THANATI_WARES,
  OBOL_SLUG,
  BULLET,
  isThanati,
  isThanatiLeader,
  listComrades,
  formatComrades,
  hideoutRoom,
  chanterReady,
};
