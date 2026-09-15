// Opening a conversation: the one copy of it. A conversation is a private Discord thread hanging off
// a LOCATION channel (Discord has no threads inside threads, so a Room is only the link the whisper
// poll reads) plus a PlayerThread row and a PlayerThreadMember per member — the row is the truth and
// Discord's thread membership is its projection (db/lib/conversations.js). Does the DISCORD half, so
// post-commit work like everything else in db/lib/locationMove.js: callers run it after their own
// writes land, and it never throws — a caller gets `{ ok: false, error }`. Takes `prisma` as a
// parameter, off the @lifeweb/db barrel like db/lib/dm.js; require it by path.
const { startPrivateThread, addThreadMember } = require("./discordRest");
const { addConversationMember } = require("./conversations");

// `characterIds` is everybody who should be in it, creator included; each is added as a row first,
// then to the Discord thread, so a failed thread add never decides whether the conversation shows up
// in somebody's places. A "web only" character is left off the Discord side (CHAT.md §6) — their row
// is their membership.
async function openConversationThread(
  prisma,
  { locationId, roomId = null, name, characterIds = [], creatorCharacterId = null } = {},
) {
  const trimmed = String(name ?? "").trim().slice(0, 90);
  if (!trimmed) return { ok: false, error: "Give it a name." };
  if (!locationId) return { ok: false, error: "That place has no channel yet — tell a GM." };

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { id: true, name: true, discordChannelId: true },
  });
  if (!location?.discordChannelId) {
    return { ok: false, error: "That place has no channel yet — tell a GM." };
  }

  const wanted = [...new Set(characterIds.filter(Boolean).map(String))];
  const members = await prisma.character.findMany({
    where: { id: { in: wanted } },
    select: { id: true, discordUserId: true, discordMirrored: true },
  });

  let thread;
  try {
    thread = await startPrivateThread(location.discordChannelId, trimmed);
  } catch (err) {
    console.error(`Failed to open a conversation in ${location.name}:`, err);
    return { ok: false, error: "Couldn't open that — try again, or tell a GM." };
  }

  const creator = members.find((m) => m.id === creatorCharacterId) ?? null;
  const openTurn = await prisma.turn
    .findFirst({ where: { status: "OPEN" }, select: { number: true } })
    .catch(() => null);
  const conversation = await prisma.playerThread.create({
    data: {
      threadId: thread.id,
      name: trimmed,
      locationId: location.id,
      roomId,
      creatorCharacterId: creator?.id ?? null,
      creatorDiscordUserId: creator?.discordUserId ?? null,
      lastActivityTurn: openTurn?.number ?? null,
    },
  });

  for (const member of members) {
    await addConversationMember(prisma, {
      playerThreadId: conversation.id,
      characterId: member.id,
    }).catch((err) => console.error(`Conversation member row for ${member.id} failed:`, err));
    if (member.discordUserId && member.discordMirrored) {
      await addThreadMember(thread.id, member.discordUserId).catch(() => {});
    }
  }

  return { ok: true, conversation, threadId: thread.id };
}

module.exports = { openConversationThread };
