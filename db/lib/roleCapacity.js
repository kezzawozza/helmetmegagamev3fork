// Seat math for a Role, shared by the character-creation picker, the
// createCharacter server action's race check, and the GM panel — so all
// three agree on what "full" means.
//
// The three shapes come straight from docs/roles.yaml's multiple/weight
// pair (see Role in schema.prisma):
//   isUnique  -> exactly 1 seat, at any game size. A single named character
//                (Baron, Bishop, Headman) — NOT the same as "1 per 100".
//   unlimited -> uncapped chaff roles (Commoner, Migrant).
//   weight    -> seats per 100 players, scaled by GameConfig.playerCount.
//
// Returns Infinity for uncapped roles so callers can compare `taken < cap`
// without special-casing. A weighted role never rounds below 1 — a role
// listed in the YAML should always be pickable by somebody, even at a small
// player count where round() would otherwise floor it to zero.
function roleCapacity(role, playerCount) {
  if (role.isUnique) return 1;
  if (role.unlimited) return Infinity;
  if (role.weight == null) return 1;
  return Math.max(1, Math.round((role.weight * playerCount) / 100));
}

// Seats that never reopen. A seat is normally held only by a LIVING character
// — the holder dies and the picker offers the role again, which is right for
// a Bum or a Cerberus. These roles are the exception: once someone has held
// the seat it stays taken for the rest of the run, dead holder or not, so
// there is never a second Baron, a second Sheriff. That includes the roles
// with a single seat at 100 players (Diplomat, Sheriff) — Gunboat confirmed
// they are one-and-done.
//
// A slug list rather than a roles.yaml key + Role column (CHARACTERS.md "Seat
// caps"): a static rule over a fixed roster, and a column would mean a live
// migration for a boolean. The caveat that comes with that: it is keyed on
// Role.slug, so renaming a slug in the YAML silently drops the role from this
// list.
const PERMANENT_SEAT_ROLE_SLUGS = [
  // The Court
  "baron",
  "baroness",
  "heir",
  "successor",
  "hand",
  "meister",
  "arbiter",
  // The Cerberon
  "censor",
  "incarn",
  // Town
  "bishop",
  "esculap",
  "inquisitor",
  "headman",
  "sheriff",
  "innkeeper",
  "brigand-leader",
  "brigand",
];

// Roles that exist ONLY as a GM spawn: never on the wizard's roster, never
// rolled by the lobby, never hand-set into a draft. Unconditional — no config
// switch turns it off. The Tribunal seats are the whole list; they carry real
// roles because a spawn needs one for its charter, kit and landing site. Kept
// here rather than in web/ so the roll (db/lib/roleAssignment.js) and the
// picker read one list.
const SPAWN_ONLY_ROLE_SLUGS = ["tribunal-ordinator", "tribune"];

function isSpawnOnly(role) {
  return SPAWN_ONLY_ROLE_SLUGS.includes(role?.slug);
}

function isPermanentSeat(role) {
  return PERMANENT_SEAT_ROLE_SLUGS.includes(role?.slug);
}

// Which Character.status values occupy a seat of this role. The one
// definition behind every `taken` count — the wizard's picker, the seat
// reservation, and createCharacter's in-transaction race check — so they
// can never disagree about who is sitting in a chair. CURSED is in the enum
// but nothing writes it; listing statuses explicitly rather than dropping
// the filter keeps that true if it ever changes.
function seatHolderStatuses(role) {
  return isPermanentSeat(role) ? ["ALIVE", "DEAD"] : ["ALIVE"];
}

module.exports = {
  roleCapacity,
  PERMANENT_SEAT_ROLE_SLUGS,
  SPAWN_ONLY_ROLE_SLUGS,
  isSpawnOnly,
  isPermanentSeat,
  seatHolderStatuses,
};
