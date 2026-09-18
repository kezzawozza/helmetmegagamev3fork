"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
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

  // The desks re-filter from client state (GmZoneViewProvider.js) off these
  // names, so they need no revalidation. /chat is different: its left column
  // is server-rendered from placesFor (db/lib/feedAccess.js#gmPlacesFor) and
  // has no client-side zone filter. This covers the NEXT navigation to the
  // page; an already-open tab is refreshed by the rail itself, which re-reads
  // /api/feed/places on a confirmed write (GmAside.js). Every server path —
  // the page, that route and the stream — reads the same zone filter. Null,
  // not [], means "every zone" — see inVisibleZones.
  revalidatePath("/chat");
  return { ok: true, zoneNames: zones.length > 0 ? zones.map((z) => z.name) : null };
}
