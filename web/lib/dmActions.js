// Which of a DM thread's buttons are still worth drawing.
//
// A Discord button stays clickable forever — the message sits in the DM
// history with its components on it, and pressing a dead one just gets a
// refusal. The web can do better, because a button here is a view of a pending
// row (db/lib/dmActions.js): ask which rows are still answerable, and draw only
// those. So a thread scrolled back a month shows the offers as the record they
// are, not a wall of live-looking Accept buttons.
//
// This is belt-and-braces, never the only guard. The server action re-validates
// everything, because a server action is a public endpoint and a disabled input
// is a hint, not a lock.
import { prisma } from "@lifeweb/db";
import { DM_ACTION, dmActionOf } from "@lifeweb/db/lib/dmActions";
import { isHeldOpen } from "@lifeweb/db/lib/locationGraph";

// Group the page's descriptors by kind, so each family costs one query however
// many rows carry it.
function byKind(rows) {
  const out = new Map();
  for (const row of rows) {
    const action = dmActionOf(row);
    if (!action) continue;
    if (!out.has(action.kind)) out.set(action.kind, new Set());
    out.get(action.kind).add(action.id);
  }
  return out;
}

async function liveOffers(ids, viewer) {
  if (!viewer.characterId) return [];
  const rows = await prisma.offer.findMany({
    where: { id: { in: ids }, status: "PENDING", responderId: viewer.characterId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function liveThreatSpawns(ids, viewer) {
  const rows = await prisma.threatSpawn.findMany({
    where: { id: { in: ids }, status: "PENDING", discordUserId: viewer.discordUserId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function liveLobbySeats(ids, viewer) {
  // ASSIGNED, not PENDING: a seat that has already been built into a character
  // (CREATED) is no longer declinable — db/lib/lobby.js#declineAssignment.
  const rows = await prisma.lobbyEntry.findMany({
    where: { id: { in: ids }, status: "ASSIGNED", discordUserId: viewer.discordUserId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function liveKeyedWays(ids, viewer) {
  if (!viewer.characterId) return [];
  const [links, character] = await Promise.all([
    prisma.locationLink.findMany({
      where: { id: { in: ids }, keyed: true },
      select: { id: true, openUntil: true, requiredTagSlug: true },
    }),
    prisma.character.findUnique({
      where: { id: viewer.characterId },
      select: { tags: { select: { tag: { select: { slug: true } } } } },
    }),
  ]);
  const held = new Set((character?.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
  // Already propped open, and the question is moot; no key, and it was never
  // theirs to answer. Both are what holdKeyedOpen would say anyway.
  return links
    .filter((link) => !isHeldOpen(link) && (!link.requiredTagSlug || held.has(link.requiredTagSlug)))
    .map((link) => link.id);
}

// A bird's letter is still answerable while the window is open — the turn it
// arrived in and the one after (docs/systemdocs/BIRD.md). The authority is
// db/lib/birdReply.js#birdReplyWindow, which the answer re-runs; this is the
// cheap read-side half of it, so a thread scrolled back a month shows old
// letters as the record they are rather than a column of live Reply links.
//
// Literacy is deliberately NOT checked here. It is checked at the answer, and
// a Reply that refuses out loud tells a player who has just been blinded
// something a silently missing link never would.
async function liveBirdReplies(ids, viewer) {
  if (!viewer.characterId) return [];
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  // Between turns the bird is waiting, not gone — the same call the window
  // makes, and refusing here would grey a letter that is still answerable.
  const rows = await prisma.birdMessage.findMany({
    where: {
      id: { in: ids },
      recipientId: viewer.characterId,
      delivered: true,
      repliedAt: null,
      ...(openTurn ? { replyDeadlineTurn: { gte: openTurn.number } } : { replyDeadlineTurn: { not: null } }),
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

const RESOLVERS = {
  [DM_ACTION.OFFER]: liveOffers,
  [DM_ACTION.THREAT_SPAWN]: liveThreatSpawns,
  [DM_ACTION.LOBBY_SEAT]: liveLobbySeats,
  [DM_ACTION.KEYED_WAY]: liveKeyedWays,
  [DM_ACTION.BIRD_REPLY]: liveBirdReplies,
};

// Stamps `actionable: true` on every row whose descriptor still names something
// this viewer can answer. Rows without a descriptor are returned untouched, so
// this is safe to run over a whole page.
//
// `viewer` is { discordUserId, characterId } resolved from the SESSION by the
// caller — never from anything the client posted.
export async function resolveDmActions(rows, viewer) {
  const groups = byKind(rows);
  if (groups.size === 0) return rows;

  const live = new Set();
  // Sequential rather than Promise.all: these are four small indexed reads and
  // the page is already waiting on them, so there is nothing to win by racing.
  for (const [kind, ids] of groups) {
    const resolver = RESOLVERS[kind];
    if (!resolver) continue;
    try {
      for (const id of await resolver([...ids], viewer)) live.add(`${kind}:${id}`);
    } catch (err) {
      // A failed lookup draws no button, which is the safe direction: the
      // player can still answer on Discord.
      console.error(`Resolving ${kind} DM actions failed:`, err);
    }
  }

  return rows.map((row) => {
    const action = dmActionOf(row);
    if (!action) return row;
    return { ...row, actionable: live.has(`${action.kind}:${action.id}`) };
  });
}
