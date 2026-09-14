// How many of a role's seats are spoken for: characters sitting in them (ALIVE, plus DEAD on a seat that never reopens), a live wizard hold (RoleReservation), and a live lobby assignment (LobbyEntry ASSIGNED with a future expiresAt — LOBBY.md §4). One function so every caller agrees what "full" means.
// `excludeDiscordUserId` leaves out the caller's OWN hold and assignment, so re-reserving to slide an expiry never fails against itself.

const { seatHolderStatuses, isPermanentSeat } = require("./roleCapacity");

async function heldSeats(db, role, { excludeDiscordUserId = null, now = new Date() } = {}) {
  const others = excludeDiscordUserId ? { discordUserId: { not: excludeDiscordUserId } } : {};
  const [seated, reserved, assigned] = await Promise.all([
    db.character.count({ where: { roleId: role.id, status: { in: seatHolderStatuses(role) } } }),
    db.roleReservation.count({ where: { roleId: role.id, expiresAt: { gt: now }, ...others } }),
    db.lobbyEntry.count({
      where: { assignedRoleId: role.id, status: "ASSIGNED", expiresAt: { gt: now }, ...others },
    }),
  ]);
  return seated + reserved + assigned;
}

// The same count for MANY roles at once, as three groupBys rather than three queries per role. Returns Map<roleId, held>.
async function heldSeatsByRole(db, roles, { excludeDiscordUserId = null, now = new Date() } = {}) {
  if (roles.length === 0) return new Map();
  const roleIds = roles.map((r) => r.id);
  const permanentIds = roles.filter(isPermanentSeat).map((r) => r.id);
  const others = excludeDiscordUserId ? { discordUserId: { not: excludeDiscordUserId } } : {};
  const [alive, dead, reserved, assigned] = await Promise.all([
    db.character.groupBy({ by: ["roleId"], where: { roleId: { in: roleIds }, status: "ALIVE" }, _count: true }),
    permanentIds.length === 0
      ? []
      : db.character.groupBy({ by: ["roleId"], where: { roleId: { in: permanentIds }, status: "DEAD" }, _count: true }),
    db.roleReservation.groupBy({
      by: ["roleId"],
      where: { roleId: { in: roleIds }, expiresAt: { gt: now }, ...others },
      _count: true,
    }),
    db.lobbyEntry.groupBy({
      by: ["assignedRoleId"],
      where: { assignedRoleId: { in: roleIds }, status: "ASSIGNED", expiresAt: { gt: now }, ...others },
      _count: true,
    }),
  ]);
  const counts = new Map();
  const bump = (id, n) => counts.set(id, (counts.get(id) ?? 0) + n);
  for (const row of [...alive, ...dead, ...reserved]) bump(row.roleId, row._count);
  for (const row of assigned) bump(row.assignedRoleId, row._count);
  return counts;
}

module.exports = { heldSeats, heldSeatsByRole };
