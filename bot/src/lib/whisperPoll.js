const { concealedAlias, withArticle } = require("@lifeweb/db/lib/concealedIdentity");
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { sceneLineAt } = require("@lifeweb/db/lib/scene");
const { leakLine } = require("@lifeweb/db/lib/whisperLeak");

// Every 15 minutes, each Room hears who has been whispering in the
// Conversations linked to it — "You hear a young man and an old woman whispering."
// — and never who they are. That is the whole trade the feature exists for:
// a private thread is genuinely private, but the room it happens in knows
// somebody is having it.
//
// It also hears FRAGMENTS of what was said — a few contiguous runs of words
// pulled out of the window at random and garbled to near-nothing
// (db/lib/whisperLeak.js). A private thread is still private in the sense that
// matters, because what survives is word shapes and the odd word intact, never
// a sentence. But standing in a room where two people are muttering now tells
// you a little, which is what standing there ought to do.
//
// Everyone is aliased, concealed or not (db/lib/concealedIdentity.js). The
// room learns an age and a presentation, which is what standing across a
// tavern tells you, and nothing else. Subtle is the one exception, below.
//
// Stateless: one 15-minute lookback per tick, no cursor column. A restart
// across a tick may double-post a line or skip one, which is cheaper than a
// row of bookkeeping for flavor text.

// Subtle is the one tag that opts a character out of the line entirely: the
// room never notices them at it. Everyone else in the thread is still named,
// so a Subtle whisperer hides in a conversation rather than silencing it —
// only an all-Subtle thread goes quiet.
const SUBTLE_SLUG = "subtle";

const WINDOW_MINUTES = 15;
// Past this many, the line stops being informative and starts being a wall.
const MAX_NAMED = 5;

// Oxford comma throughout, and a hard stop at MAX_NAMED so a crowded thread
// reads as a crowd instead of a roster.
function joinAliases(aliases) {
  if (aliases.length === 1) return aliases[0];
  if (aliases.length === 2) return `${aliases[0]} and ${aliases[1]}`;
  if (aliases.length <= MAX_NAMED) {
    return `${aliases.slice(0, -1).join(", ")}, and ${aliases[aliases.length - 1]}`;
  }
  return `${aliases.slice(0, MAX_NAMED).join(", ")}, and others`;
}

// ArchiveEntry.discordChannelId already holds the THREAD id for a proxied
// message, indexed with sentAt — so "who spoke in here lately" is one query
// over a table that already exists, and the poll needs no table of its own.
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
    // No `distinct` any more: the leak needs every message, not one row per
    // speaker, and the speaker set falls out of the same rows in JS.
    select: { discordChannelId: true, characterId: true, content: true },
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
    // Nobody spoke, or the linked room was never provisioned a thread.
    if (!rows?.length || !conversation.room?.discordThreadId) continue;

    // Subtle drops out before anyone is aliased AND before a word of theirs
    // reaches the leak pool — the room never notices them at it, which has to
    // mean both halves or the tag only half works. Nothing downstream runs when
    // that empties the thread, so the Discord post and the Room's feed row are
    // skipped together — there is no half-suppressed whisper.
    // A row whose character could not be loaded is treated as Subtle rather
    // than as audible. `!speakers.get(id)?.tags?.length` would read a missing
    // character as "no Subtle tag" and put their words in the pool — a privacy
    // feature has to fail shut, and silence is the cheaper mistake of the two.
    const heardRows = rows.filter((row) => {
      const speaker = speakers.get(row.characterId);
      return speaker && !speaker.tags.length;
    });
    if (!heardRows.length) continue;
    const audible = [...new Set(heardRows.map((row) => row.characterId))];

    // Rolled ONCE and handed to both sinks. db/lib/shout.js deliberately
    // re-rolls its static per call, but that only changes which characters are
    // lost; re-rolling here would pick different FRAGMENTS for Discord and for
    // Chat, which is two different leaks rather than one heard twice.
    const leak = leakLine(heardRows.map((row) => row.content));
    const quoted = leak ? [leak] : [];

    const aliases = audible.map((id) =>
      withArticle(concealedAlias(speakers.get(id) ?? {}).toLowerCase()),
    );
    // "You hear …" leads every audible line in the game, which is also what
    // retires the is/are agreement and the leading capital this used to need.
    const heard = `You hear ${joinAliases(aliases)} whispering.`;
    const line = ambientLine(heard, quoted, { signed: false });

    // Sequential and catch-logged: one unreachable room must not stop the
    // rest of the tick, and a burst of parallel posts is what trips the
    // invalid-response breaker.
    try {
      // `{ parse: [] }` because this line carries PLAYER text, which is the
      // condition db/lib/discordRest.js#postMessage names for passing one.
      // whisperLeak strips the `<@id>` spellings, but "@everyone" and "@here"
      // are plain words that no stripper catches and Discord would honour.
      await postMessage(conversation.room.discordThreadId, line, undefined, { parse: [] });
      posted += 1;
    } catch (err) {
      console.error(`Whisper post to ${conversation.room.discordThreadId} failed:`, err.message ?? err);
    }
    // The Room's feed hears it too — one row per tick, same as the post.
    await sceneLineAt(prisma, { roomId: conversation.room.id, text: heard, lines: quoted });
  }
  return posted;
}

module.exports = {
  runWhisperPoll,
};
