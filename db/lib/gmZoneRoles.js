// Turns a GM's GmZoneView rows into actual Discord roles. The choice must be MATERIALIZED — Discord
// can't subtract a role grant from one member, so "everybody sees Town, this GM doesn't" needs the
// channel overwrite unconditional and the role to vary per person. A role per zone rather than a
// per-member channel overwrite, because the channel doctor deletes any member overwrite on a zone or
// Location channel as a stray on every bot start and after every turn (CHANNELS.md §3) — roles it
// already reconciles. No superadmin special case: one with no GmZoneView rows already sees every zone.
const { addMemberRole, removeMemberRole, getGuildMember } = require("./discordRest");
const { visibleZoneIds } = require("./gmZoneView");
const { hasGmRole } = require("./roleIds");

// Every zone with a GM role to hand out; one with none isn't yet provisioned and is skipped, not
// treated as invisible.
async function gmRoleZones(prisma) {
  return prisma.zone.findMany({
    where: { gmRoleId: { not: null } },
    select: { id: true, name: true, gmRoleId: true },
  });
}

// Grants and revokes so `discordUserId` holds exactly the GM roles for zones they can see. Idempotent
// (a no-op grant/revoke is a no-op at Discord) and best-effort per role — one failed grant shouldn't
// cost the GM the other five zones.
async function syncGmZoneRoles(prisma, discordUserId) {
  if (!discordUserId) return { granted: 0, revoked: 0 };

  const zones = await gmRoleZones(prisma);
  if (zones.length === 0) return { granted: 0, revoked: 0 };

  // Read what they hold rather than blindly PUT/DELETE all seven — a rate-limit problem before a
  // correctness one.
  const member = await getGuildMember(discordUserId).catch(() => null);
  const held = new Set(member?.roles ?? []);

  // A non-GM wants no zones regardless of the table — otherwise the no-rows-means-everything rule
  // would hand an ex-GM's empty table the whole map on demotion.
  const isGm = member ? hasGmRole(member.roles) : false;
  const visible = isGm ? await visibleZoneIds(prisma, discordUserId) : new Set();
  const wanted = new Set(
    zones.filter((z) => visible === null || visible.has(z.id)).map((z) => z.gmRoleId),
  );

  let granted = 0;
  let revoked = 0;
  for (const zone of zones) {
    const want = wanted.has(zone.gmRoleId);
    const has = held.has(zone.gmRoleId);
    if (want && !has) {
      await addMemberRole(discordUserId, zone.gmRoleId).catch((err) =>
        console.error(`GM zone view: couldn't grant ${zone.name} to ${discordUserId}:`, err.message ?? err),
      );
      granted += 1;
    } else if (!want && has) {
      await removeMemberRole(discordUserId, zone.gmRoleId).catch((err) =>
        console.error(`GM zone view: couldn't revoke ${zone.name} from ${discordUserId}:`, err.message ?? err),
      );
      revoked += 1;
    }
  }
  return { granted, revoked };
}

// Catch-up for everyone holding a GM seat, so a new GM is seated without finding the control first.
// Sequential on purpose — runs at startup, where the rate limiter matters more than speed.
async function syncAllGmZoneRoles(prisma, gmDiscordUserIds) {
  let touched = 0;
  for (const id of gmDiscordUserIds ?? []) {
    const { granted, revoked } = await syncGmZoneRoles(prisma, id);
    if (granted || revoked) touched += 1;
  }
  return touched;
}

module.exports = { syncGmZoneRoles, syncAllGmZoneRoles };
