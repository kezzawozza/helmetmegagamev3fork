// Applies a character's standing conversation invites when they arrive in a Location — the second half of the /add contract: "invite anyone; they see the thread when they get here." Discord refuses a thread member who can't view the parent channel, so /add records a PlayerThreadInvite row and every Location arrival replays the invites through this function.
// Takes `prisma` as a parameter — the db/lib/dm.js convention — and is deliberately not on the @lifeweb/db barrel; require it by path.
const { addThreadMember } = require("./discordRest");
const { addConversationMember } = require("./conversations");

async function applyPendingInvites(prisma, character) {
  if (!character?.locationId || !character.discordUserId) return 0;

  const invites = await prisma.playerThreadInvite.findMany({
    where: { characterId: character.id },
  });
  if (invites.length === 0) return 0;

  const threads = await prisma.playerThread.findMany({
    where: {
      threadId: { in: invites.map((i) => i.threadId) },
      locationId: character.locationId,
    },
    select: { id: true, threadId: true },
  });

  // The "web only" switch (CHAT.md §6) skips the Discord add below, but the membership row is still written and the INVITE ROW IS LEFT WHERE IT IS to replay when they come back off the switch.
  const webOnly =
    character.webOnly ??
    (
      await prisma.character
        .findUnique({ where: { id: character.id }, select: { webOnly: true } })
        .catch(() => null)
    )?.webOnly ??
    false;

  let applied = 0;
  for (const { id, threadId } of threads) {
    // The ROW first, then the account. Membership is a database fact (db/lib/conversations.js), so a Discord call that fails must not be what decides whether the web feed shows the conversation.
    await addConversationMember(prisma, { playerThreadId: id, characterId: character.id });
    if (webOnly) continue;
    try {
      await addThreadMember(threadId, character.discordUserId);
      applied += 1;
    } catch (err) {
      console.error(`Failed to apply thread invite ${threadId} for ${character.id}:`, err.message);
    }
  }
  return applied;
}

module.exports = { applyPendingInvites };
