const { concealedAlias, withArticle } = require("@lifeweb/db/lib/concealedIdentity");
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { sceneLineAt } = require("@lifeweb/db/lib/scene");
const { leakLine } = require("@lifeweb/db/lib/whisperLeak");

// Every 15 minutes, each Room hears who has been whispering in the
// Conversations linked to it — "You hear a young man and an old woman
// whispering." — and never who they are. It also hears FRAGMENTS of what was
// said, garbled to near-nothing (db/lib/whisperLeak.js). Everyone is aliased,
// concealed or not (db/lib/concealedIdentity.js); Subtle is the one
// exception, below. Stateless: one 15-minute lookback per tick, no cursor
// column — a restart across a tick may double-post or skip a line, cheaper
// than bookkeeping for flavor text.

const SUBTLE_SLUG = "subtle"; // opts a character out of the line entirely; only an all-Subtle thread goes quiet

const WINDOW_MINUTES = 15;
const MAX_NAMED = 5; // past this many, the line stops informing and starts being a wall

function joinAliases(aliases) {
  if (aliases.length === 1) return aliases[0];
  if (aliases.length === 2) return `${aliases[0]} and ${aliases[1]}`;
  if (aliases.length <= MAX_NAMED) {
    return `${aliases.slice(0, -1).join(", ")}, and ${aliases[aliases.length - 1]}`;
  }
  return `${aliases.slice(0, MAX_NAMED).join(", ")}, and others`;
}

async function runWhisperPoll(prisma) {
  const conversations = await prisma.playerThread.findMany({
    where: { roomId: { not: null } },
    select: { threadId: true, room: { select: { id: true, discordThreadId: true } } },
  });
  if (conversations.length === 0) return 0;

  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const entries = await prisma.archiveEntry.findMany({
    where: {
      kind: "MESSAGE",
      sentAt: { gte: since },
      discordChannelId: { in: conversations.map((c) => c.threadId) },
      characterId: { not: null },
    },
    select: { discordChannelId: true, characterId: true, content: true }, // no `distinct`; leak needs every message
  });
  if (entries.length === 0) return 0;

  const byThread = new Map();
  for (const entry of entries) {
    const list = byThread.get(entry.discordChannelId) ?? [];
    list.push(entry);
    byThread.set(entry.discordChannelId, list);
  }

  const speakers = new Map(
    (
      await prisma.character.findMany({
        where: { id: { in: [...new Set(entries.map((e) => e.characterId))] } },
        select: {
          id: true,
          age: true,
          gender: true,
          tags: { where: { tag: { slug: SUBTLE_SLUG } }, select: { id: true } },
        },
      })
    ).map((c) => [c.id, c]),
  );

  let posted = 0;
  for (const conversation of conversations) {
    const rows = byThread.get(conversation.threadId);
    if (!rows?.length || !conversation.room?.discordThreadId) continue;

    // Subtle drops out before anyone is aliased AND before their words reach
    // the leak pool — fails shut for a missing character too, treating it as
    // Subtle rather than audible.
    const heardRows = rows.filter((row) => {
      const speaker = speakers.get(row.characterId);
      return speaker && !speaker.tags.length;
    });
    if (!heardRows.length) continue;
    const audible = [...new Set(heardRows.map((row) => row.characterId))];

    // Rolled ONCE and handed to both sinks, so Discord and Chat leak the same fragment.
    const leak = leakLine(heardRows.map((row) => row.content));
    const quoted = leak ? [leak] : [];

    const aliases = audible.map((id) =>
      withArticle(concealedAlias(speakers.get(id) ?? {}).toLowerCase()),
    );
    const heard = `You hear ${joinAliases(aliases)} whispering.`;
    const line = ambientLine(heard, quoted, { signed: false });

    try {
      // `{ parse: [] }` since this carries PLAYER text; whisperLeak strips
      // `<@id>` but not "@everyone"/"@here", which Discord would still honour.
      await postMessage(conversation.room.discordThreadId, line, undefined, { parse: [] });
      posted += 1;
    } catch (err) {
      console.error(`Whisper post to ${conversation.room.discordThreadId} failed:`, err.message ?? err);
    }
    await sceneLineAt(prisma, { roomId: conversation.room.id, text: heard, lines: quoted });
  }
  return posted;
}

module.exports = {
  runWhisperPoll,
};
