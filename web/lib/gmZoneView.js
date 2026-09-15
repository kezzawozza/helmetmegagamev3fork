import { cache } from "react";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "./discordGuild";
import { sortZones } from "./zones";

// Decides what the desks show and which "GM: <Zone>" Location channels exist (db/lib/gmZoneRoles.js).
// NULL MEANS EVERY ZONE, never an empty list.
export const getVisibleZones = cache(async () => {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return null;
  const rows = await prisma.gmZoneView.findMany({
    where: { discordUserId: session.discordUserId },
    include: { zone: { select: { id: true, name: true } } },
  });
  if (rows.length === 0) return null;
  return sortZones(rows.map((r) => r.zone).filter(Boolean));
});

export const listSelectableZones = cache(async () => {
  const zones = await prisma.zone.findMany({
    where: { gmRoleId: { not: null }, retiredAt: null },
    select: { id: true, name: true },
  });
  return sortZones(zones);
});
