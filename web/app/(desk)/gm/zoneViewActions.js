"use server";

import { after } from "next/server";
import { prisma, setVisibleZones } from "@lifeweb/db";
import { syncGmZoneRoles } from "@lifeweb/db/lib/gmZoneRoles";
import { getGmSession } from "@/lib/discordGuild";

// Sets which zones the CALLING GM sees. Never takes a target id: a server
// action is a public endpoint, and the only person anyone may re-scope is
// themselves.
export async function setVisibleZonesAction(zoneIds) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return { ok: false, error: "Not authorized." };

  const wanted = Array.isArray(zoneIds) ? zoneIds.map(String).filter(Boolean) : [];
  // Re-resolved against the table rather than trusted — a bad posted id would otherwise become a row nothing can ever clear.
  const zones = wanted.length > 0
    ? await prisma.zone.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } })
    : [];
  if (zones.length !== wanted.length) return { ok: false, error: "That zone doesn't exist." };

  await setVisibleZones(prisma, session.discordUserId, zones.map((z) => z.id));

  // Runs AFTER the response — up to seven sequential rate-limited role
  // PUT/DELETEs made a click take twenty seconds otherwise. Best-effort;
  // rows are already written and /zone reconciles from the same table.
  after(async () => {
    await syncGmZoneRoles(prisma, session.discordUserId).catch((err) =>
      console.error("GM zone view: role sync failed:", err.message ?? err),
    );
  });

  // No revalidatePath — desks re-filter from client state
  // (GmZoneViewProvider.js) off these names. Null, not [], means "every zone" — see inVisibleZones.
  return { ok: true, zoneNames: zones.length > 0 ? zones.map((z) => z.name) : null };
}
