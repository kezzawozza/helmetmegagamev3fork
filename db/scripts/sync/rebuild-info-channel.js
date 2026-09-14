// Wipe+rebuild of #info from docs/systemdocs/infochannel.yaml (`npm run
// db:rebuild-info-channel`). This is the DESTRUCTIVE one and no longer the
// default: every run deletes every message and thread and rebuilds from
// scratch, notifying everyone following a thread. Reach for `npm run
// db:sync-info-channel` instead, which edits in place; this one is for when
// the channel's ORDER is wrong or it's a mess. The content half (YAML,
// generators, directory message) lives in db/lib/infoChannel.js
// (INFOCHANNEL.md).
require("dotenv").config();
const path = require("node:path");
const {
  fetchAllMessages,
  bulkDeleteMessages,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  startThread,
  postMessageBatched,
  postAttachment,
} = require("../../lib/discordRest");
const {
  DOCS_DIR,
  loadInfoDoc,
  resolveThreadBody,
  findInfoChannel,
  buildDirectoryMessage,
  deleteThreadCreatedMessages,
} = require("../../lib/infoChannel");

async function wipeChannel(channelId) {
  const messages = await fetchAllMessages(channelId);
  if (messages.length > 0) await bulkDeleteMessages(channelId, messages.map((m) => m.id));
  console.log(`  deleted ${messages.length} message(s)`);

  const active = await listActiveThreadsForChannel(channelId);
  const archivedPublic = await listArchivedPublicThreads(channelId);
  const archivedPrivate = await listArchivedPrivateThreads(channelId);
  const byId = new Map();
  for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) byId.set(thread.id, thread);
  const threads = [...byId.values()];

  for (const thread of threads) await deleteThread(thread.id);
  console.log(`  deleted ${threads.length} thread(s)`);
}

async function createThreads(channelId, categories) {
  const linksByCategory = [];

  for (const category of categories) {
    const links = [];
    for (const thread of category.threads) {
      const created = await startThread(channelId, thread.title);
      await postMessageBatched(created.id, resolveThreadBody(thread));
      console.log(`  created thread: ${thread.title}`);
      links.push(created.id);
    }
    linksByCategory.push({
      name: category.name,
      intro: category.intro,
      threadIds: links,
      titles: category.threads.map((t) => t.title),
    });
  }

  return linksByCategory;
}

async function main() {
  const doc = loadInfoDoc();

  const channel = await findInfoChannel();
  console.log(`Found #info (${channel.id})`);

  console.log("Wiping #info...");
  await wipeChannel(channel.id);

  // Posted before threads are created: Discord orders oldest-first, and
  // thread creation itself emits system messages into the timeline.
  if (doc.banner) {
    console.log("Posting banner...");
    await postAttachment(channel.id, path.join(DOCS_DIR, doc.banner));
  }

  console.log("Creating threads...");
  const linksByCategory = await createThreads(channel.id, doc.categories);

  console.log("Posting directory message...");
  const directoryMessage = buildDirectoryMessage(doc.main_message, linksByCategory);
  await postMessageBatched(channel.id, directoryMessage);

  console.log("Cleaning up thread-created system messages...");
  await deleteThreadCreatedMessages(channel.id);

  const threadCount = linksByCategory.reduce((sum, c) => sum + c.threadIds.length, 0);
  console.log(`Done: ${linksByCategory.length} categor(y/ies), ${threadCount} thread(s) posted to #info.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
