// In-place sync of #info from docs/systemdocs/infochannel.yaml (`npm run
// db:sync-info-channel`). This is the one to reach for — Discord sends no
// notification for an EDIT, so this matches what's live against the YAML,
// rewrites changed bodies, creates only genuinely new threads.
//
// THE MATCH KEY IS THE THREAD TITLE — #info has no DB row of any kind, so the
// title plays the part `slug` plays elsewhere. Renaming a thread reads as "a
// new thread, plus an orphan", reported rather than guessed at. It cannot
// REORDER: threads keep Discord's position, so a YAML reorder changes only
// the directory listing — `npm run db:rebuild-info-channel` is for that.
//
// Flags:
//   --dry-run   print the plan, write nothing
//   --prune     delete threads the YAML no longer names (reported otherwise)
require("dotenv").config();
const path = require("node:path");
const {
  discordRequest,
  fetchAllMessages,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  patchThread,
  startThread,
  postMessage,
  postMessageBatched,
  postAttachment,
  editMessage,
  deleteMessage,
  chunkMessage,
} = require("../../lib/discordRest");
const {
  DOCS_DIR,
  loadInfoDoc,
  resolveThreadBody,
  infoThreads,
  findInfoChannel,
  buildDirectoryMessage,
  deleteThreadCreatedMessages,
} = require("../../lib/infoChannel");

const DRY_RUN = process.argv.includes("--dry-run");
const PRUNE = process.argv.includes("--prune");

// Every reconcile below is scoped to messages the bot itself wrote.
let botUserId = null;
async function getBotUserId() {
  if (botUserId) return botUserId;
  botUserId = process.env.DISCORD_CLIENT_ID || null;
  if (!botUserId) botUserId = (await discordRequest("/users/@me")).id;
  return botUserId;
}

async function ownMessages(channelId) {
  const me = await getBotUserId();
  const messages = await fetchAllMessages(channelId);
  return messages.filter((m) => m.author?.id === me);
}

// Rewrites `channelId` so the bot's own messages there read exactly `text`.
// Chunk i is edited onto message i, a surplus chunk is posted, a surplus
// message is deleted. Identical content is left completely alone.
async function reconcileMessages(channelId, text, existing, label) {
  const chunks = chunkMessage(text);
  let edited = 0;
  let posted = 0;
  let deleted = 0;

  for (let i = 0; i < chunks.length; i++) {
    const message = existing[i];
    if (!message) {
      if (!DRY_RUN) await postMessage(channelId, chunks[i]);
      posted += 1;
      continue;
    }
    if (message.content === chunks[i]) continue;
    if (!DRY_RUN) await editMessage(channelId, message.id, chunks[i]);
    edited += 1;
  }

  for (const message of existing.slice(chunks.length)) {
    if (!DRY_RUN) await deleteMessage(channelId, message.id);
    deleted += 1;
  }

  const changes = [
    edited ? `${edited} edited` : null,
    posted ? `${posted} posted` : null,
    deleted ? `${deleted} deleted` : null,
  ].filter(Boolean);
  console.log(`  ${label}: ${changes.length > 0 ? changes.join(", ") : "unchanged"}`);
  return changes.length > 0;
}

async function liveThreadsByTitle(channelId) {
  const active = await listActiveThreadsForChannel(channelId);
  const archivedPublic = await listArchivedPublicThreads(channelId);
  const archivedPrivate = await listArchivedPrivateThreads(channelId);

  const byId = new Map();
  for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) byId.set(thread.id, thread);

  const byTitle = new Map();
  for (const thread of byId.values()) byTitle.set(String(thread.name ?? "").trim().toLowerCase(), thread);
  return { byId, byTitle };
}

function assertUniqueTitles(doc) {
  const seen = new Set();
  const duplicates = [];
  for (const thread of infoThreads(doc)) {
    const key = String(thread.title ?? "").trim().toLowerCase();
    if (seen.has(key)) duplicates.push(thread.title);
    seen.add(key);
  }
  if (duplicates.length > 0) { // matching is by title; fail before touching Discord
    throw new Error(`infochannel.yaml has duplicate thread titles: ${duplicates.join(", ")}`);
  }
}

async function main() {
  const doc = loadInfoDoc();
  assertUniqueTitles(doc);

  const channel = await findInfoChannel();
  console.log(`Found #info (${channel.id})${DRY_RUN ? " — DRY RUN, nothing will be written" : ""}`);

  const { byId, byTitle } = await liveThreadsByTitle(channel.id);
  const matchedIds = new Set();
  let created = 0;

  const linksByCategory = [];
  for (const category of doc.categories ?? []) {
    const threadIds = [];
    for (const entry of category.threads ?? []) {
      const key = String(entry.title ?? "").trim().toLowerCase();
      const live = byTitle.get(key);
      const body = resolveThreadBody(entry);

      if (!live) {
        console.log(`  ${entry.title}: NEW thread`);
        created += 1;
        if (!DRY_RUN) {
          const made = await startThread(channel.id, entry.title);
          await postMessageBatched(made.id, body);
          threadIds.push(made.id);
        }
        continue;
      }

      matchedIds.add(live.id);
      threadIds.push(live.id);
      if (live.thread_metadata?.archived && !DRY_RUN) { // wake it first; unarchiving notifies nobody
        await patchThread(live.id, { archived: false });
      }
      await reconcileMessages(live.id, body, await ownMessages(live.id), entry.title);
    }
    linksByCategory.push({ name: category.name, intro: category.intro, threadIds });
  }

  const orphans = [...byId.values()].filter((t) => !matchedIds.has(t.id));
  for (const thread of orphans) {
    if (PRUNE) {
      if (!DRY_RUN) await deleteThread(thread.id);
      console.log(`  ${thread.name}: pruned (not in infochannel.yaml)`);
    } else {
      console.log(`  ${thread.name}: not in infochannel.yaml — leaving it (--prune deletes)`);
    }
  }

  const topLevel = await ownMessages(channel.id); // banner posted only when #info has none — reposting notifies
  if (doc.banner && !topLevel.some((m) => (m.attachments?.length ?? 0) > 0)) {
    console.log("  banner: posting (none present)");
    if (!DRY_RUN) await postAttachment(channel.id, path.join(DOCS_DIR, doc.banner));
  }

  const directoryMessage = buildDirectoryMessage(doc.main_message, linksByCategory);
  const directoryMessages = topLevel.filter((m) => (m.attachments?.length ?? 0) === 0);
  await reconcileMessages(channel.id, directoryMessage, directoryMessages, "directory message");

  if (created > 0 && !DRY_RUN) await deleteThreadCreatedMessages(channel.id);

  const threadCount = linksByCategory.reduce((sum, c) => sum + c.threadIds.length, 0);
  console.log(
    `Done: ${threadCount} thread(s) in #info, ${created} created, ${orphans.length} not in the YAML.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
