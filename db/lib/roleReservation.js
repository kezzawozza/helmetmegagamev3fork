// Seat holds for a role in progress on the creation wizard, so a player who
// picks a capacity-1 role and spends ten minutes on the tag menu doesn't lose
// the seat at Confirm with no warning. Wizard-side half; the race-closing
// lock lives in createActions.js's create transaction.
//
// Takes `prisma` as its first parameter (db/lib/dm.js convention),
// deliberately off the @lifeweb/db barrel — db/lib/roleCapacity.js (the
// seat-cap math this builds on) IS in the barrel, so requiring by path keeps
// the two call shapes distinct.
const { roleCapacity } = require("./roleCapacity");
const { heldSeats, heldSeatsByRole } = require("./seatCount");

// Long enough to read the tag menu, short enough that an abandoned tab frees
// a unique seat the same session. Refreshed on every wizard step advance.
const RESERVATION_TTL_MS = 30 * 60 * 1000;

// Called inline by every read/write below rather than from a cron job.
async function sweepExpired(tx, roleId) {
  await tx.roleReservation.deleteMany({ where: { roleId, expiresAt: { lt: new Date() } } });
}

// Takes a row lock on the Role first so two concurrent reservers serialize
// instead of both reading the same stale count.
async function reserveRole(prisma, discordUserId, roleId, playerCount) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${roleId} FOR UPDATE`;
    await sweepExpired(tx, roleId);

    const role = await tx.role.findUnique({ where: { id: roleId } });
    if (!role) return { ok: false, reason: "ROLE_NOT_FOUND" };

    const cap = roleCapacity(role, playerCount);
    // Caller's own hold on THIS role doesn't count against itself.
    if ((await heldSeats(tx, role, { excludeDiscordUserId: discordUserId })) >= cap) {
      return { ok: false, reason: "ROLE_FULL" };
    }

    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
    // @unique on discordUserId: reserving a different role releases the
    // first as part of the same upsert.
    await tx.roleReservation.upsert({
      where: { discordUserId },
      create: { discordUserId, roleId, expiresAt },
      update: { roleId, expiresAt },
    });
    return { ok: true, expiresAt };
  });
}

// The picker's count, everyone EXCEPT the caller, so a player's own hold
// renders their role available to them and taken to everyone else.
async function takenCounts(prisma, roles, excludeDiscordUserId) {
  if (roles.length === 0) return new Map();
  await prisma.roleReservation.deleteMany({
    where: { roleId: { in: roles.map((r) => r.id) }, expiresAt: { lt: new Date() } },
  });
  return heldSeatsByRole(prisma, roles, { excludeDiscordUserId: excludeDiscordUserId ?? null });
}

async function releaseRole(prisma, discordUserId) {
  await prisma.roleReservation.deleteMany({ where: { discordUserId } });
}

module.exports = { reserveRole, takenCounts, releaseRole };
