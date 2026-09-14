// Post-commit tail for every server action that changes a character's tags or ⬢: settleCarry,
// narrowcast/room access, the drop's Discord work, corpse follow, in that order, best-effort and
// catch-logged — a missed sync is the channel doctor's problem (CHANNELS.md §6). Never call this inside a transaction.
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { settleCarry, deliverCarryDrop } from "@lifeweb/db/lib/carry";
import { syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { reconcileCorpses } from "@lifeweb/db/lib/corpseFollow";
import { refreshCorpseWeight } from "@lifeweb/db/lib/corpseWeight";
import { syncCharacterNarrowcastAccess } from "@/lib/discordGuild";

export async function afterInventoryChange(characters) {
  const ids = [...new Set([].concat(characters).filter(Boolean).map((c) => (typeof c === "string" ? c : c.id)))];
  for (const id of ids) {
    const settled = await settleCarry(prisma, id).catch((err) => {
      console.error(`settleCarry failed for ${id}:`, err);
      return null;
    });
    await refreshCorpseWeight(prisma, id).catch(() => {});
    const row = await prisma.character
      .findUnique({ where: { id }, select: { id: true, discordUserId: true, locationId: true, status: true } })
      .catch(() => null);
    after(() => syncCharacterNarrowcastAccess(id).catch(() => {}));
    if (row) after(() => syncCharacterRoomAccess(prisma, row).catch(() => {}));
    if (settled?.drop) after(() => deliverCarryDrop(prisma, settled).catch(() => {}));
  }
  if (ids.length) await reconcileCorpses(prisma).catch((err) => console.error("corpse follow failed:", err));
}
