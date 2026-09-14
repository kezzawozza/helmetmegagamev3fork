// Thread-level REST helpers: creation (public/private/forum), membership,
// listing, and the couple of channel-patch shims that make sense to keep
// beside threads rather than in channels.js.

const { discordRequest, THREAD_CREATE_MAX_RETRY_AFTER_MS } = require("./core");
const { patchChannel, getChannel } = require("./channels");

// type 11 = GUILD_PUBLIC_THREAD, no starter message — the caller posts it.
// `rateLimitPerUser` is the thread's own slowmode, in seconds. A thread does
// NOT inherit its parent channel's, and Discord only takes it at creation or
// through a PATCH — which is why db/lib/syncZones.js re-asserts it on every
// pass beside `archived: false`.
//
// `messageId`, when given, threads off an EXISTING message instead
// (`POST /channels/{id}/messages/{messageId}/threads`) — Discord derives the
// type from the message, so `type` is omitted on that path.
async function startThread(channelId, name, autoArchiveMinutes = 10080, rateLimitPerUser = null, messageId = null) {
  const path = messageId
    ? `/channels/${channelId}/messages/${messageId}/threads`
    : `/channels/${channelId}/threads`;
  return discordRequest(path, {
    method: "POST",
    // Thread creation is the one route Discord rate-limits by the MINUTE. A
    // Restart Game wipe creates 129 of them in a row, and giving up at the 30 s
    // cap is how a wipe ended with no Room threads and no anchors (2026-09-06).
    maxRetryAfterMs: THREAD_CREATE_MAX_RETRY_AFTER_MS,
    body: {
      name,
      ...(messageId ? {} : { type: 11 }),
      auto_archive_duration: autoArchiveMinutes,
      ...(rateLimitPerUser === null ? {} : { rate_limit_per_user: rateLimitPerUser }),
    },
  });
}

// A forum thread cannot exist without its starter message, so it's created
// here in one call rather than via startThread. `thread.id` doubles as the
// starter message's id.
async function createForumPost(
  forumChannelId,
  { name, content, appliedTags = [], autoArchiveMinutes = 10080, components = undefined, allowedMentions = undefined },
) {
  // allowedMentions: pass one whenever content carries user text — Discord's
  // default parses everything, and a character named "@everyone" would ping.
  const message = { content, ...(components ? { components } : {}), ...(allowedMentions ? { allowed_mentions: allowedMentions } : {}) };
  return discordRequest(`/channels/${forumChannelId}/threads`, {
    method: "POST",
    body: {
      name,
      applied_tags: appliedTags,
      auto_archive_duration: autoArchiveMinutes,
      message,
    },
  });
}

// type 12, invitable:false — only ManageThreads (bot, GMs) may add members,
// which is what keeps /add the only door in.
async function startPrivateThread(channelId, name, autoArchiveMinutes = 10080, rateLimitPerUser = null) {
  return discordRequest(`/channels/${channelId}/threads`, {
    method: "POST",
    // Thread creation is the one route Discord rate-limits by the MINUTE. A
    // Restart Game wipe creates 129 of them in a row, and giving up at the 30 s
    // cap is how a wipe ended with no Room threads and no anchors (2026-09-06).
    maxRetryAfterMs: THREAD_CREATE_MAX_RETRY_AFTER_MS,
    body: {
      name,
      type: 12,
      auto_archive_duration: autoArchiveMinutes,
      invitable: false,
      ...(rateLimitPerUser === null ? {} : { rate_limit_per_user: rateLimitPerUser }),
    },
  });
}

// Silent add — channel.members.add would ping-mention the target.
async function addThreadMember(threadId, userId) {
  return discordRequest(`/channels/${threadId}/thread-members/${userId}`, {
    method: "PUT",
    allow404: true,
  });
}

// The revoke half of db/lib/roomAccess.js — a key tag lost is a room door
// closed. 404 is "wasn't a member", which is the state we want.
async function removeThreadMember(threadId, userId) {
  return discordRequest(`/channels/${threadId}/thread-members/${userId}`, {
    method: "DELETE",
    allow404: true,
  });
}

// Every member of a thread, paginated (100 per page). The doctor diffs this
// against what db/lib/roomAccess.js says a private room's roster should be.
async function listThreadMembers(threadId) {
  const members = [];
  let after = null;
  for (;;) {
    const page = await discordRequest(
      `/channels/${threadId}/thread-members?limit=100${after ? `&after=${after}` : ""}`,
      { allow404: true },
    );
    if (!page || page.length === 0) break;
    members.push(...page);
    if (page.length < 100) break;
    after = page[page.length - 1].user_id;
  }
  return members;
}

// A thread is a channel, so this is patchChannel under a clearer name.
// flags bit 1 (value 2) is PINNED, pinning a forum post to the top of its
// forum — there is no /pins endpoint for forum posts.
const THREAD_FLAG_PINNED = 2;

async function patchThread(threadId, payload) {
  return patchChannel(threadId, payload);
}

// No per-channel "active threads" endpoint, only guild-wide — filtered
// client-side by parent_id. `snapshot` lets a caller fetch once and reuse.
async function fetchActiveThreads() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const { threads } = await discordRequest(`/guilds/${guildId}/threads/active`);
  return threads;
}

async function listActiveThreadsForChannel(channelId, snapshot = null) {
  const threads = snapshot ?? (await fetchActiveThreads());
  return threads.filter((t) => t.parent_id === channelId);
}

async function listArchivedThreads(channelId, visibility) {
  const threads = [];
  let before;

  for (;;) {
    const query = before ? `?before=${encodeURIComponent(before)}&limit=100` : "?limit=100";
    const page = await discordRequest(`/channels/${channelId}/threads/archived/${visibility}${query}`);
    if (!page?.threads?.length) break;
    threads.push(...page.threads);
    if (!page.has_more) break;
    before = page.threads[page.threads.length - 1].thread_metadata?.archive_timestamp;
    if (!before) break;
  }

  return threads;
}

async function listArchivedPublicThreads(channelId) {
  return listArchivedThreads(channelId, "public");
}

async function listArchivedPrivateThreads(channelId) {
  return listArchivedThreads(channelId, "private");
}

async function deleteThread(threadId) {
  return discordRequest(`/channels/${threadId}`, { method: "DELETE", allow404: true });
}

async function getForumTagId(channelId, tagName) {
  const channel = await getChannel(channelId);
  return channel.available_tags?.find((t) => t.name === tagName)?.id ?? null;
}


module.exports = {
  startThread,
  createForumPost,
  patchThread,
  THREAD_FLAG_PINNED,
  fetchActiveThreads,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  getForumTagId,
  startPrivateThread,
  addThreadMember,
  removeThreadMember,
  listThreadMembers,
};
