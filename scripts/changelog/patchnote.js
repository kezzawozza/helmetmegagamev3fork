// The player-facing patch note. Posted to #patch-notes, not the GM changelog
// (scripts/changelog/log.js) — different audience, different rule.
//
// Same format as the changelog — a heading, then ✚ − ✎ notes — but the words
// are never derived from a commit, a branch, or a diff. There is no fallback
// source for them, on purpose: this script refuses outright if you don't
// supply a heading and at least one note. AI-generated prose does not belong
// in a player-facing patch note; the human at the keyboard writes it.
//
//   npm run patchnote -- "Crossing into the Caves warns you first" \
//     "+A confirmation before you step into the dark" \
//     "-The old silent crossing" \
//     "Cave rooms are quieter now"
//
// Notes land in a thread named for today ("Sat Sep 12"), reused across the
// day if a matching thread already exists, so a day's patch notes stay
// together instead of scattering across separate posts.
require("dotenv").config();
const { normalizeNote, clamp } = require("./log");

// Not a secret — see db/lib/roleIds.js and scripts/changelog/log.js for the
// reasoning. The env var is a scratch-channel override for testing.
const CHANNEL_ID = process.env.PATCHNOTE_CHANNEL_ID || "1548386629562007672";

function threadTitle() {
  // "Sat Sep 12" — no comma. toLocaleDateString gives "Sat, Sep 12", so build
  // it from the parts instead of formatting the whole string at once.
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

// Positionals not consumed by a flag: the first is the heading, the rest are
// notes — same shape as `npm run push -- "Subject" "note" "note"`.
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
// it. #patch-notes may be an ordinary text channel or a forum channel —
// those need different Discord calls, so the channel's own type decides.
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
    // Don't leave an orphan starter message with no thread behind — a retry
    // would never find it (it only looks for the THREAD by name) and would
    // just post another one, leaking a "Sat Sep 12" row into the channel
    // every time this step fails. Roll the starter back and let the caller's
    // failure be the only trace.
    await deleteMessage(CHANNEL_ID, starter.id).catch(() => {});
    throw err;
  }
  await postMessageBatched(thread.id, text);
  return thread.id;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");

  const [subject, ...rest] = positionals(argv);
  const notes = [...rest, ...collect(argv, "--note")].map(normalizeNote).filter(Boolean);

  if (!subject || !subject.trim()) {
    console.error('patchnote: no heading given. Usage: npm run patchnote -- "Heading" "+note" "-note" "note"');
    process.exitCode = 1;
    return;
  }
  if (notes.length === 0) {
    console.error("patchnote: no notes given. A patch note needs at least one — write it yourself, it isn't generated for you.");
    process.exitCode = 1;
    return;
  }

  const title = threadTitle();
  const text = body(subject, notes);

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
