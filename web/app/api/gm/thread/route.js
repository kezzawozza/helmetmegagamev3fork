import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers, isGuildRosterKnown } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import { withoutDmNoise } from "@/lib/dmThread";

// GET /api/gm/thread?user=<discordUserId>[&beforeMs=&beforeId=]
//
// One conversation, for the desk's pane. This is what the [discordUserId]
// route segment used to render, moved to a route handler for the three
// reasons this desk keeps running into:
//
//   1. A route handler is off the router's serial ACTION queue, so it cannot
//      be stuck behind a GM's own send or a rail search.
//   2. It can be ABORTED. An RSC navigation cannot, which is why clicking
//      three people in a row used to make the third wait for the first two.
//   3. It cannot reach Next's build-mismatch full reload whatever it answers.
//
// Two shapes, one route. Without a cursor it returns the whole pane payload —
// header plus the newest page. With `beforeMs`/`beforeId` it returns only an
// older page, which is what the thread's "load older" sentinel asks for.
//
// `gmProfiles` and the acting GM's own id are deliberately NOT here: they are
// desk-wide, the layout already has them, and fetching them per conversation
// is what made opening somebody cost a Discord round trip.
export const dynamic = "force-dynamic";

const TAKE_DEFAULT = 100;
const TAKE_MAX = 200;

export async function GET(request) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 204 });

  const { searchParams } = new URL(request.url);
  const discordUserId = searchParams.get("user");
  if (!discordUserId) return new Response("Which conversation?", { status: 400 });

  const beforeMs = Number(searchParams.get("beforeMs")) || null;
  const beforeId = searchParams.get("beforeId") || null;
  const take = Math.min(Math.max(1, Number(searchParams.get("take")) || TAKE_DEFAULT), TAKE_MAX);

  // Keyset page, newest-first then reversed into reading order — the same
  // cursor actions.js#getDmThreadPage has always used.
  const where = { discordUserId };
  if (beforeMs) {
    const beforeDate = new Date(beforeMs);
    where.OR = [
      { createdAt: { lt: beforeDate } },
      beforeId ? { createdAt: beforeDate, id: { lt: beforeId } } : undefined,
    ].filter(Boolean);
  }

  const older = Boolean(beforeMs);
  const rows = await prisma.directMessage.findMany({
    where: withoutDmNoise(where),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });
  const hasMore = rows.length > take;
  const messages = rows.slice(0, take).reverse();

  if (older) {
    return Response.json({ messages, hasMore }, { headers: { "cache-control": "no-store" } });
  }

  const [guildMembers, character, aliveCharacter, claim, openTurn, readCursor] = await Promise.all([
    listGuildMembers(),
    prisma.character.findFirst({ where: { discordUserId }, orderBy: { createdAt: "desc" } }),
    prisma.character.findFirst({
      where: { discordUserId, status: "ALIVE" },
      orderBy: { createdAt: "desc" },
      include: { zone: { select: { name: true } } },
    }),
    prisma.conversationMeta.findUnique({ where: { playerDiscordUserId: discordUserId } }),
    getOpenTurn(),
    // This GM's read cursor, for the thread's NEW line. Read before the pane's
    // mark-read effect moves it.
    prisma.conversationRead.findUnique({
      where: {
        gmDiscordUserId_playerDiscordUserId: {
          gmDiscordUserId: session.discordUserId,
          playerDiscordUserId: discordUserId,
        },
      },
      select: { lastReadAt: true },
    }),
  ]);

  const username = guildMembers.find((m) => m.id === discordUserId)?.username;
  // Unknown id → 404. A guild member with no character and no conversation yet
  // is not unknown — they are exactly who a GM opens to message first. And the
  // check must not fire when we never heard back from Discord at all, which is
  // what an empty roster can mean; isGuildRosterKnown() is the difference.
  if (isGuildRosterKnown() && messages.length === 0 && !character && !username) {
    return new Response("No such person.", { status: 404 });
  }

  const openMove =
    aliveCharacter && openTurn
      ? await prisma.action.findUnique({
          where: { characterId_turnId: { characterId: aliveCharacter.id, turnId: openTurn.id } },
          select: { id: true },
        })
      : null;

  return Response.json(
    {
      discordUserId,
      label: character?.name ?? username ?? discordUserId,
      // The account behind the character, shipped BESIDE the label rather than
      // folded into it: ConversationPane also hands `label` to CharacterAvatar
      // as the alt name, where "Aleksei Ivanov (@forgeybot)" would be wrong.
      // Thrown away here until now — once a character existed the handle never
      // reached the desk at all, so a GM reading a thread could not tell which
      // account they were answering. Same source the rail's @handle already
      // uses (listGuildMembers), so the two can't disagree.
      username: username ?? null,
      characterId: aliveCharacter?.id ?? character?.id ?? null,
      avatarVersion: (aliveCharacter ?? character)?.updatedAt.getTime() ?? null,
      zoneName: aliveCharacter?.zone?.name ?? null,
      status: character && character.status !== "ALIVE" ? character.status : null,
      moveId: openMove?.id ?? null,
      claimedByDiscordUserId: claim?.claimedByDiscordUserId ?? null,
      lastReadAtMs: readCursor?.lastReadAt ? readCursor.lastReadAt.getTime() : 0,
      messages,
      hasMore,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
