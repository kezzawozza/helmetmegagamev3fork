// The player-facing patch note. Posted to #patch-notes, not the GM changelog
// (scripts/changelog/log.js). Same format — a heading, then ✚ − ✎ notes —
// but never derived from a commit, branch, or diff: refuses outright with no
// notes supplied, since the human at the keyboard writes it. Heading is
// always the flat "Patch notes".
//
//   npm run patchnote -- \
//     "+A confirmation before you step into the dark" \
//     "-The old silent crossing" \
//     "Cave rooms are quieter now"
//
// Notes land in a thread named for today ("Sat Sep 12"), reused across the day.
require("dotenv").config();
const { normalizeNote, clamp } = require("./log");

const CHANNEL_ID = process.env.PATCHNOTE_CHANNEL_ID || "1548386629562007672"; // not a secret; see roleIds.js
const SUBJECT = "Patch notes"; // always this — never taken from an argument

function threadTitle() {
  // "Sat Sep 12", no comma — toLocaleDateString gives "Sat, Sep 12".
  const now = new Date();
  const weekday = now.toLocaleDateString("en-US", { weekday: "short" });
  const month = now.toLocaleDateString("en-US", { month: "short" });
  const day = now.getDate();
  return `${weekday} ${month} ${day}`;
}

function body(subject, notes) {
  return [`**${subject}**`, ...clamp(notes)].join("\n");
}

function collect(argv, flag) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === flag && argv[i + 1] !== undefined) out.push(argv[i + 1]);
  return out;
}

function positionals(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--note") {
      i += 1;
      continue;
    }
    if (argv[i] === "--dry-run") continue;
    out.push(argv[i]);
  }
  return out;
}

// Finds (or creates) today's patch-notes thread, then posts the entry into
// it. #patch-notes may be a text or forum channel, needing different calls.
async function postToThread(title, text) {
  const {
    getChannel,
    listActiveThreadsForChannel,
    startThread,
    postMessage,
    postMessageBatched,
    createForumPost,
    deleteMessage,
  } = require("../../db/lib/discordRest");

  const channel = await getChannel(CHANNEL_ID);
  const FORUM = 15;

  if (channel.type === FORUM) {
    const existing = (await listActiveThreadsForChannel(CHANNEL_ID)).find((t) => t.name === title);
    if (existing) {
      await postMessageBatched(existing.id, text);
      return existing.id;
    }
    const thread = await createForumPost(CHANNEL_ID, { name: title, content: text });
    return thread.id;
  }

  const existing = (await listActiveThreadsForChannel(CHANNEL_ID)).find((t) => t.name === title);
  if (existing) {
    await postMessageBatched(existing.id, text);
    return existing.id;
  }
  const starter = await postMessage(CHANNEL_ID, `**${title}**`);
  let thread;
  try {
    thread = await startThread(CHANNEL_ID, title, undefined, null, starter.id);
  } catch (err) {
    await deleteMessage(CHANNEL_ID, starter.id).catch(() => {}); // no orphan starter; a retry can't find it by name
    throw err;
  }
  await postMessageBatched(thread.id, text);
  return thread.id;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");

  const notes = [...positionals(argv), ...collect(argv, "--note")].map(normalizeNote).filter(Boolean);

  if (notes.length === 0) {
    console.error('patchnote: no notes given. Usage: npm run patchnote -- "+note" "-note" "note"');
    process.exitCode = 1;
    return;
  }

  const title = threadTitle();
  const text = body(SUBJECT, notes);

  if (dryRun) {
    console.log(`patchnote: would post to #patch-notes (${CHANNEL_ID}), thread "${title}"\n\n${text}`);
    return;
  }

  const threadId = await postToThread(title, text);
  console.log(`patchnote: posted to thread "${title}" (${threadId}).`);
}

main().catch((err) => {
  console.error(`patchnote: failed — ${err.message}`);
  process.exitCode = 1;
});
