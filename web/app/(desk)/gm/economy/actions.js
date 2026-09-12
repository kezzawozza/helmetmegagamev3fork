"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { rebuild } from "@lifeweb/db/lib/economyRollup";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { UserError, guarded } from "@/lib/actionResult";

// Rebuild the per-turn rollup from the ledger. Superadmin only — this is a
// cache invalidation over the whole game's books, not a routine GM verb, and
// a layout gate is presentation, so this re-checks both the GM gate and the
// superadmin allowlist itself.
export async function rebuildRollupAction() {
  return guarded(async () => {
    const { session, isGm } = await getGmSession();
    if (!session?.discordUserId) throw new UserError("Not authenticated.");
    if (!isGm) throw new UserError("Not authorized.");
    if (!isSuperadmin(session.discordUserId)) throw new UserError("Superadmin only.");

    const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { gameId: true } });
    if (!state?.gameId) throw new UserError("No current game.");

    const result = await rebuild(prisma, state.gameId);
    revalidatePath("/gm/economy");
    return result;
  });
}
