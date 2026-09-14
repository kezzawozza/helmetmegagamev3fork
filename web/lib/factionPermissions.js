// Prisma-binding shim over db/lib/factionPermissions.js (the bot needs it too). Web call sites never pass prisma.
import { prisma } from "@lifeweb/db";
import * as shared from "@lifeweb/db/lib/factionPermissions";

export function getMyFactionRole(discordUserId, factionId) {
  return shared.getMyFactionRole(prisma, discordUserId, factionId);
}

export function getFactionAncestorIds(factionId) {
  return shared.getFactionAncestorIds(prisma, factionId);
}
