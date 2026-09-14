// Conversation membership, in the database.
//
// A Conversation is a PlayerThread: a private Discord thread hanging off a
// Location channel, opened with the Converse button. Until phase 2 of Chat
// the answer to "who is in it" lived ONLY in Discord's thread-member list,
// which had two problems. The web feed could not read it without a REST call
// per conversation per render, and a player whose Discord account is out of
// the channels entirely (the phase 5 "web only" switch) could not be in one at
// all.
//
// So the row is the truth now and Discord is its projection: every writer
// records the member here first, then adds the account. There are four of
// them — the Converse modal, /add, a mention into a conversation, and the
// invite replay — which is exactly why they share these functions rather than
// each doing their own upsert.
//
// Takes `prisma` as a parameter, the db/lib/dm.js convention: db/index.js
// imports this, so requiring it back would resolve to a partial exports
// object.

const { mentionedIdsIn } = require("./characterMentions");
const { presentedMembers, presentedNameOf } = require("./presentedMembers");
const { notifyPresence } = require("./presenceNotify");

// Every writer works from a Discord THREAD id, because that is what the
// interaction hands them; PlayerThread.id is the row's own cuid. One lookup
// here spares four call sites from remembering the difference.
async function conversationByThreadId(prisma, threadId) {
  if (!threadId) return null;
  return prisma.playerThread.findUnique({
    where: { threadId },
    select: { id: true, threadId: true, name: true, locationId: true },
  });
}

// Idempotent: a second /add on somebody already in the room is a no-op, and
// the presence notify only fires when the row is genuinely new, so a replayed
// invite does not wake every one of that player's tabs on every arrival.
async function addConversationMember(prisma, { playerThreadId = null, threadId = null, characterId } = {}) {
  if (!characterId) return false;
  const id = playerThreadId ?? (await conversationByThreadId(prisma, threadId))?.id ?? null;
  if (!id) return false;

  const existing = await prisma.playerThreadMember
    .findUnique({ where: { playerThreadId_characterId: { playerThreadId: id, characterId } }, select: { characterId: true } })
    .catch(() => null);
  if (existing) return false;

  const created = await prisma.playerThreadMember
    .create({ data: { playerThreadId: id, characterId } })
    .catch((err) => {
      // A unique violation is two writers racing on the same invite, which is
      // the state we wanted anyway.
      if (err?.code !== "P2002") console.error(`Conversation member add failed for ${characterId}:`, err.message ?? err);
      return null;
    });
  if (!created) return false;

  await notifyPresence(prisma, characterId);
  return true;
}

async function removeConversationMember(prisma, { playerThreadId = null, threadId = null, characterId } = {}) {
  if (!characterId) return false;
  const id = playerThreadId ?? (await conversationByThreadId(prisma, threadId))?.id ?? null;
  if (!id) return false;

  const { count } = await prisma.playerThreadMember
    .deleteMany({ where: { playerThreadId: id, characterId } })
    .catch((err) => {
      console.error(`Conversation member remove failed for ${characterId}:`, err.message ?? err);
      return { count: 0 };
    });
  if (count === 0) return false;

  await notifyPresence(prisma, characterId);
  return true;
}

// The conversations one character is in. `locationId` narrows them to the
// place they are standing, which is what Discord already does one layer down:
// a thread is only visible to somebody who can view its PARENT channel, and a
// character holds that overwrite for exactly one Location at a time. Leaving
// the list unfiltered would show a web player a room they had walked out of.
async function conversationsFor(prisma, characterId, { locationId = undefined } = {}) {
  if (!characterId) return [];
  const rows = await prisma.playerThreadMember.findMany({
    where: {
      characterId,
      ...(locationId === undefined ? {} : { playerThread: { locationId } }),
    },
    orderBy: { createdAt: "asc" },
    select: {
      playerThread: {
        select: { id: true, threadId: true, name: true, locationId: true, roomId: true },
      },
    },
  });
  return rows.map((row) => row.playerThread).filter(Boolean);
}

// Who is in one conversation, as raw ids. The rows ARE the membership, so
// this is the whole answer and it is the ONLY thing either face should ask.
//
// The ids stay on the server. conversationMembers below is the presented list
// and deliberately carries no id for anybody in a hood, so a membership test
// has to be answered off these rather than off those: your own row is a hood
// like any other when you are wearing one, and matching on a withheld id would
// lock you out of your own conversation.
async function conversationMemberIds(prisma, playerThreadId) {
  if (!playerThreadId) return [];
  const rows = await prisma.playerThreadMember.findMany({
    where: { playerThreadId },
    orderBy: { createdAt: "asc" },
    select: { characterId: true },
  });
  return rows.map((row) => row.characterId);
}

// Being a member IS the permission to work the door — to /add or /remove
// somebody else. Both faces ask this one question.
//
// Discord's thread-member list is NOT the question, though the bot used to ask
// it: a web-only character is in the rows and in no thread anywhere, so they
// were in a conversation they could not invite anybody to. The rows have been
// the truth since phase 2 (see the header); this is the last place that had
// not caught up.
async function isConversationMember(prisma, playerThreadId, characterId) {
  if (!playerThreadId || !characterId) return false;
  const ids = await conversationMemberIds(prisma, playerThreadId);
  return ids.includes(characterId);
}

// Who is in one conversation. The rows ARE the membership (Discord's thread
// member list is their projection), so this is the whole answer and it needs
// no REST call — which is the point: Chat draws it beside every message.
//
// Dead members are dropped rather than shown greyed. A conversation is a
// corner of a room, not a roster, and a body cannot be in one.
//
// Two queries rather than one join: PlayerThreadMember.characterId is a plain
// column with no relation behind it (see the model), so there is nothing for
// an `include` to walk.
//
// The projection is db/lib/presentedMembers.js, which is the same resolver the
// HERE column goes through. It used to be `select: { id, name, updatedAt }`
// straight off the row, so the strip at the top of a conversation named a
// hooded member outright and drew their real portrait beside it — the reason
// "inviting someone breaks disguises" was a true sentence.
//
// `viewer` is who is asking, and it is required for that: the sighting rule
// decides whether a mask is drawn at all. A caller with nobody to be (the
// bot's own bookkeeping) passes null and gets every hood plateless, which errs
// toward hiding.
async function conversationMembers(prisma, playerThreadId, viewer, options) {
  if (!playerThreadId) return [];
  const rows = await prisma.playerThreadMember.findMany({
    where: { playerThreadId },
    orderBy: { createdAt: "asc" },
    select: { characterId: true },
  });
  if (rows.length === 0) return [];
  // Kept in the order they were added, which is the order the rows came back
  // in — presentedMembers preserves whatever order it is handed.
  return presentedMembers(prisma, rows.map((row) => row.characterId), viewer, options);
}

// Pinging somebody into a conversation puts them IN it, the way it does in
// Discord. A mention of somebody who is not a member used to be a name they
// never saw: the row rendered as a chip, they were told nothing, and the one
// person the message was for was the one person who could not read it.
//
// Only conversations. A room is opened by a key or a guest row and a mention
// is neither, and the street is already open to everyone standing in it.
//
// Follows the returned-side-effects pattern (ARCHITECTURE.md): the rows are
// written here — the PlayerThreadMember that IS the membership, and the
// PlayerThreadInvite beside it that replays the Discord half when they next
// reach the Location — and the caller performs the Discord adds and the DMs
// with whichever client it holds. `content` is the row as stored, so the
// tokens are the same ones the feed renders.
//
// The speaker cannot pull themselves in, and somebody already in is skipped
// without a second notify.
async function pullMentionedIntoConversation(prisma, { conversation, content, speakerId } = {}) {
  if (!conversation?.id || typeof content !== "string") return [];

  // mentionedIdsIn, not a second copy of the grammar. This file used to
  // re-declare the token regex inline, which stopped matching the moment the
  // token learned to carry a name — a mention would still ping and still
  // render and simply stop pulling anyone into the room.
  const wanted = mentionedIdsIn(content).filter((id) => id !== speakerId);
  if (wanted.length === 0) return [];

  const members = await prisma.playerThreadMember.findMany({
    where: { playerThreadId: conversation.id, characterId: { in: wanted } },
    select: { characterId: true },
  });
  const inside = new Set(members.map((row) => row.characterId));
  const outside = wanted.filter((id) => !inside.has(id));
  if (outside.length === 0) return [];

  // Living characters only, and re-read from the DB rather than trusted off
  // the token: a {char:…} is player-typed text.
  const targets = await prisma.character.findMany({
    where: { id: { in: outside }, status: "ALIVE" },
    select: { id: true, name: true, locationId: true, discordUserId: true, webOnly: true },
  });

  const added = [];
  for (const target of targets) {
    const isNew = await addConversationMember(prisma, {
      playerThreadId: conversation.id,
      characterId: target.id,
    });
    if (!isNew) continue;

    if (conversation.threadId) {
      await prisma.playerThreadInvite
        .upsert({
          where: { threadId_characterId: { threadId: conversation.threadId, characterId: target.id } },
          update: {},
          create: { threadId: conversation.threadId, characterId: target.id },
        })
        .catch((err) => console.error("Failed to record thread invite:", err?.message ?? err));
    }
    // The presented name rides along beside the real one, so a caller telling
    // the pinger who was invited has a name it may print. `name` stays because
    // the Discord half needs the real character to act on; `shownName` is the
    // only one that belongs in a sentence. Resolved per target rather than in
    // one batch: `added` is however many people one message named, so it is a
    // handful at most, and a batch would have to be zipped back by index —
    // which silently desyncs the moment one of them stops being ALIVE between
    // the two queries.
    const shownName = await presentedNameOf(prisma, target.id, { id: speakerId });
    added.push({ ...target, shownName });
  }
  return added;
}

module.exports = {
  conversationMemberIds,
  isConversationMember,
  addConversationMember,
  pullMentionedIntoConversation,
  removeConversationMember,
  conversationsFor,
  conversationMembers,
};
