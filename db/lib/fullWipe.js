// Restart Game's message wipe (wipeGameData, web/app/(app)/gm/dev/actions.js)
// — distinct from the routine per-turn message wipe (messageWipe.js), which
// spares the Room threads' starters and the location anchors. This one does
// not: every message-bearing channel and every anchor/starter clears, on the
// theory that a restart is a bigger reset than a turn. What it does NOT do
// any more is touch structure — no category, channel or role is ever
// deleted. That is now the Discord mirror's job (db/lib/discordMirror),
// which repairs whatever this empties, including a quest Room's thread and
// a zone Room's starter, once finishGameWipe runs it in "full" scope.
// Entirely sequential, same rate-limit reasoning as messageWipe.js.
const {
  getGuildChannels,
  fetchAllMessages,
  bulkDeleteMessages,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
} = require("./discordRest");

const CHANNEL_TYPE_TEXT = 0;

async function wipeChannelMessages(channelId) {
  const messages = await fetchAllMessages(channelId);
  if (messages.length > 0) await bulkDeleteMessages(channelId, messages.map((m) => m.id));
}

// Same sweep as the old runFullChannelWipe — every archive/turns/summary/
// location channel's messages — but it never deletes a category, a channel
// or a role, and it treats a Location's threads by what they ARE rather than
// wiping the lot:
//
//   - an ordinary zone Room's thread (no questId) is kept. Its messages are
//     cleared like any other channel, and its starter id/hash are nulled so
//     the mirror reposts the starter into the now-empty thread on its next
//     run (the same hash-mismatch trick runFullChannelWipe uses on anchors).
//   - a quest Room's thread, and any thread that matches no Room at all (a
//     Conversation, or a stray), is deleted outright. Neither needs to
//     survive: a Conversation's PlayerThread row is already gone by the time
//     this runs (wipeGameData's transaction), and a quest Room's thread is
//     one the mirror already knows how to build from scratch — buildDesired
//     puts every Room, quest ones included, into its Location's thread list
//     (discordMirror/desired.js), which is more than the old YAML sync could
//     ever do for a quest room.
//
// Anchors are nulled unconditionally, same as before: every summary/location
// channel's messages just went, so every anchor needs to repost regardless
// of whether its own hash changed.
async function wipeGameMessages(prisma) {
  const channels = await getGuildChannels();

  const archiveChannels = channels.filter((c) => c.type === CHANNEL_TYPE_TEXT && c.name?.toLowerCase() === "archive");
  for (const channel of archiveChannels) await wipeChannelMessages(channel.id);

  const turnsChannel = channels.find((c) => c.type === CHANNEL_TYPE_TEXT && c.name?.toLowerCase() === "turns");
  if (turnsChannel) await wipeChannelMessages(turnsChannel.id);

  const rooms = await prisma.room.findMany({
    where: { discordThreadId: { not: null } },
    select: { id: true, discordThreadId: true, questId: true },
  });
  const roomByThreadId = new Map(rooms.map((r) => [r.discordThreadId, r]));
  const questRoomIdsToUnlink = [];

  const zones = await prisma.zone.findMany({ include: { locations: true } });
  for (const zone of zones) {
    if (zone.discordSummaryChannelId) await wipeChannelMessages(zone.discordSummaryChannelId);
    for (const location of zone.locations) {
      if (!location.discordChannelId) continue;

      const active = await listActiveThreadsForChannel(location.discordChannelId);
      const archivedPublic = await listArchivedPublicThreads(location.discordChannelId);
      const archivedPrivate = await listArchivedPrivateThreads(location.discordChannelId);
      const threadsById = new Map();
      for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) threadsById.set(thread.id, thread);

      for (const thread of threadsById.values()) {
        const room = roomByThreadId.get(thread.id);
        if (room && !room.questId) {
          await wipeChannelMessages(thread.id);
        } else {
          await deleteThread(thread.id);
          if (room) questRoomIdsToUnlink.push(room.id);
        }
      }

      await wipeChannelMessages(location.discordChannelId);
    }
  }

  await prisma.location.updateMany({ data: { anchorMessageId: null, anchorHash: null } });
  // Zone rooms kept their thread; only the starter inside it needs a repost.
  await prisma.room.updateMany({
    where: { questId: null },
    data: { starterMessageId: null, postHash: null },
  });
  // Quest rooms lost their thread outright; unlink so the mirror creates a
  // fresh one instead of trying to hash-match a thread that is gone.
  if (questRoomIdsToUnlink.length > 0) {
    await prisma.room.updateMany({
      where: { id: { in: questRoomIdsToUnlink } },
      data: { discordThreadId: null, starterMessageId: null, postHash: null },
    });
  }
}

module.exports = { wipeGameMessages };
