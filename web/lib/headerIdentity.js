import { cache } from "react";
import "server-only";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";

// Who the header says you are, on /character and /ledger. Separate from loadFeedViewer() since a
// layout cannot be handed anything by the page inside it. cache()d.
export const loadHeaderIdentity = cache(async () => {
  const session = await auth();
  if (!session?.discordUserId) return null;
  return prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      roleTitle: true,
    },
  });
});
