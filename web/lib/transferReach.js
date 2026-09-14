// Can the acting character physically reach the other end of a transfer, a heal, a craft's payer?
// Both party kinds are Location-grain: a person via web/lib/peopleHere.js#isHere, a Room via the
// same accessibleRooms() the thread-membership sync uses, so the gate and the door never disagree.
import { prisma } from "@lifeweb/db";
import { accessibleRooms, roomAccessKeys } from "@lifeweb/db/lib/roomAccess";
import { isHere } from "@/lib/peopleHere";

// The one exception to Location-grain reach: your own faction's silo (Faction.siloRoomId,
// FACTIONS.md). Depositing works from anywhere in the room's zone; withdrawing keeps the ordinary
// rule. Deliberately skips `accessibleRooms` — a locked silo is still a mail slot to deposit into,
// which FactionConsole.js says out loud.
export async function isOwnFactionSilo(actor, party) {
  if (!actor?.factionId || !actor?.zoneId) return false;
  if (party.zoneId !== actor.zoneId) return false;
  const faction = await prisma.faction.findFirst({
    where: { id: actor.factionId, siloRoomId: party.id },
    select: { id: true },
  });
  return Boolean(faction);
}

// `party` is a resolveParty() result. `heldSlugs`/`guestRoomIds` save a lookup when the caller has
// them (a room needs BOTH, or it's re-read). `direction` ("to"/"from") only matters for the silo
// rule above; unset gives the strict, pre-silo answer.
export async function canReachParty(
  actor,
  party,
  { heldSlugs = null, guestRoomIds = null, allowDead = false, allowConcealed = false, direction = null } = {},
) {
  if (!party) return false;
  if (party.kind === "room") {
    if (direction === "to" && (await isOwnFactionSilo(actor, party))) return true;
    if (!actor?.locationId || party.locationId !== actor.locationId) return false;
    const keys =
      heldSlugs && guestRoomIds ? { heldSlugs, guestRoomIds } : await roomAccessKeys(prisma, actor.id);
    return accessibleRooms([party], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 1;
  }
  if (party.kind === "character") return isHere(actor, party, { allowDead, allowConcealed });
  return false;
}

// Kept beside the gate so every call site fails with the same words. `isSilo` splits the room
// message: "you can't get in" is wrong for a silo you can deposit into from across the zone.
export function outOfReachMessage(party, { isSilo = false } = {}) {
  if (party?.kind === "room" && isSilo) {
    return `Your silo is in ${party.name} — you have to be standing there to take anything out.`;
  }
  if (party?.kind === "room") return `You can't get into ${party.name} from where you stand.`;
  return `${party?.name ?? "They"} isn't here.`;
}
