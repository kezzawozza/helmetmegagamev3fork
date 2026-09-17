"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, MEISTERS_TERMINAL_SLUG } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { UserError, guarded } from "@/lib/actionResult";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";

// The terminal's one control. A server action is a public endpoint, so the tag
// is re-checked here and never taken from the page — a superadmin reads the
// desk but does not get the dial, since that is game permission rather than
// host access.
async function setSellTaxRateImpl({ rate: rawRate }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: {
      discordUserId: session.discordUserId,
      status: "ALIVE",
      tags: { some: { tag: { slug: MEISTERS_TERMINAL_SLUG } } },
    },
    include: { tags: { include: { tag: true } } },
  });
  if (!character) throw new UserError("That one wants the Meister's Terminal.");

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) throw new UserError(`You can't do that right now. You're ${blocker.name}.`);

  const rate = Number(rawRate);
  if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
    throw new UserError("A rate is a whole number from 0 to 100.");
  }

  const openTurn = await getOpenTurn();
  const before = (await prisma.depot.findUnique({ where: { id: 1 }, select: { sellTaxRate: true } }))?.sellTaxRate ?? 0;

  await prisma.$transaction(async (tx) => {
    await tx.depot.upsert({ where: { id: 1 }, update: { sellTaxRate: rate }, create: { id: 1, sellTaxRate: rate } });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "sell_tax_rate_set",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: { before, after: rate },
    });
  });

  revalidatePath("/treasury");
  revalidatePath("/depot");
  revalidatePath("/gm/audit");
  return { rate };
}

export async function setSellTaxRate(input) {
  return guarded(() => setSellTaxRateImpl(input));
}
