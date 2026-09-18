// Seat math for a Role, shared by the character-creation picker, createCharacter's race check, and the GM panel, so all three agree on "full".
// isUnique -> exactly 1 seat; unlimited -> uncapped; weight -> seats per 100 players (docs/roles.yaml). Infinity for uncapped roles; never rounds below 1.
function roleCapacity(role, playerCount) {
  if (role.isUnique) return 1;
  if (role.unlimited) return Infinity;
  if (role.weight == null) return 1;
  return Math.max(1, Math.round((role.weight * playerCount) / 100));
}

// The only two seats that reopen when their holder dies. Every OTHER role is
// spent for the rest of the run — a death costs the roster a seat, and nobody
// inherits it (CHARACTERS.md "Seat caps"). Keyed on Role.slug.
//
// This list used to run the other way, naming the seventeen seats that stayed
// shut while everything else refilled itself. Inverted 2026-09-18: a Merchant
// who dies takes the Merchant's chair with him, and a player who gets buried
// comes back into whatever is actually left — in a full game, these two.
const REOPENING_SEAT_ROLE_SLUGS = ["bum", "migrant"];

// Roles that exist ONLY as a GM spawn — kept here so the roll (db/lib/roleAssignment.js) and the picker read one list.
const SPAWN_ONLY_ROLE_SLUGS = ["tribunal-ordinator", "tribune"];

function isSpawnOnly(role) {
  return SPAWN_ONLY_ROLE_SLUGS.includes(role?.slug);
}

function isPermanentSeat(role) {
  return !REOPENING_SEAT_ROLE_SLUGS.includes(role?.slug);
}

// Which Character.status values occupy a seat — the one definition behind every `taken` count.
// DEAD counts almost everywhere now, so a seat is only handed back by the two roles above.
function seatHolderStatuses(role) {
  return isPermanentSeat(role) ? ["ALIVE", "DEAD"] : ["ALIVE"];
}

module.exports = {
  roleCapacity,
  REOPENING_SEAT_ROLE_SLUGS,
  SPAWN_ONLY_ROLE_SLUGS,
  isSpawnOnly,
  isPermanentSeat,
  seatHolderStatuses,
};
