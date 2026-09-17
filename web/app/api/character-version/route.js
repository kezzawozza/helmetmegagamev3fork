import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { deployVersion } from "@/lib/deployVersion";

// "Has anything on my sheet moved?" for CharacterPoller.js: a FINGERPRINT of
// location, carry, Location stashes, open turn, and the bomb's clock, so
// /character refreshes only when needed. Character from session, never
// query. Does NOT watch neighbours (dialog-only, web/lib/peoplePools.js) except open handshakes, which ARE on the page.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.discordUserId) return new Response("Not signed in.", { status: 401 });

  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true, locationId: true, zoneId: true, status: true, tagPoints: true },
  });
  if (!me) return new Response("No living character.", { status: 403 });

  // ⬢ is a CharacterTag/RoomTag stack now, not a column, so it needs no fingerprint
  // component of its own: `tags` below already carries the character's own ⬢ row
  // (it is not filtered out), and `roomTags` already sums every RoomTag in the
  // location, ⬢ included — a raw `resources` aggregate would just be counting it twice.
  const [tags, roomTags, openTurn, state, offers] = await Promise.all([
    prisma.characterTag.findMany({
      where: { characterId: me.id },
      select: { tagId: true, quantity: true, equipped: true, equippedQuantity: true, expiresTurn: true },
      orderBy: { tagId: "asc" },
    }),
    me.locationId
      ? prisma.roomTag.aggregate({
          where: { room: { locationId: me.locationId } },
          _count: { _all: true },
          _sum: { quantity: true },
          _max: { updatedAt: true },
        })
      : null,
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } }),
    prisma.gameState.findUnique({ where: { id: 1 }, select: { phase: true, nukeArmedTurn: true } }),
    prisma.offer.count({
      where: { status: "PENDING", OR: [{ initiatorId: me.id }, { responderId: me.id }] },
    }),
  ]);

  const fp = [
    me.locationId ?? "",
    me.zoneId ?? "",
    me.tagPoints,
    tags
      .map((t) => `${t.tagId}:${t.quantity}:${t.equipped ? 1 : 0}:${t.equippedQuantity}:${t.expiresTurn ?? ""}`)
      .join(","),
    roomTags?._count?._all ?? 0,
    roomTags?._sum?.quantity ?? 0,
    roomTags?._max?.updatedAt?.getTime() ?? 0,
    openTurn?.id ?? "",
    openTurn?.number ?? "",
    state?.phase ?? "",
    state?.nukeArmedTurn ?? "",
    offers,
  ].join("|");

  return Response.json(
    // `locationId` rides alongside the opaque `fp` rather than inside it, so
    // MapBoard.js can watch it alone without parsing `fp` or re-framing on
    // an unrelated change.
    { version: deployVersion(), fp, locationId: me.locationId ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
