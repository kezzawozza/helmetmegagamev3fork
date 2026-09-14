// Seat math for a Role, shared by the character-creation picker, createCharacter's race check, and the GM panel, so all three agree on "full".
// isUnique -> exactly 1 seat; unlimited -> uncapped; weight -> seats per 100 players (docs/roles.yaml). Infinity for uncapped roles; never rounds below 1.
function roleCapacity(role, playerCount) {
  if (role.isUnique) return 1;
  if (role.unlimited) return Infinity;
  if (role.weight == null) return 1;
  return Math.max(1, Math.round((role.weight * playerCount) / 100));
}

// Seats that never reopen — stay taken for the rest of the run, dead holder or not (CHARACTERS.md "Seat caps"). Keyed on Role.slug.
const PERMANENT_SEAT_ROLE_SLUGS = [
  "baron",
  "baroness",
  "heir",
  "successor",
  "hand",
  "meister",
  "arbiter",
  "censor",
  "incarn",
  "bishop",
  "esculap",
  "inquisitor",
  "headman",
  "sheriff",
  "innkeeper",
  "brigand-leader",
  "brigand",
];

// Roles that exist ONLY as a GM spawn — kept here so the roll (db/lib/roleAssignment.js) and the picker read one list.
const SPAWN_ONLY_ROLE_SLUGS = ["tribunal-ordinator", "tribune"];

function isSpawnOnly(role) {
  return SPAWN_ONLY_ROLE_SLUGS.includes(role?.slug);
}

function isPermanentSeat(role) {
  return PERMANENT_SEAT_ROLE_SLUGS.includes(role?.slug);
}

// Which Character.status values occupy a seat — the one definition behind every `taken` count.
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
