// Message-level REST helpers: posting, editing, deleting, paginated fetch,
// and the bulk-delete/clear helpers built on top of it.

const { chunkMessage } = require("../chunkText");
const { discordRequest } = require("./core");

// Discord takes attachments as multipart/form-data only. The body is a
// `payload_json` part plus one `files[n]` part per file; `attachments[].id`
// is the part index and must match the `files[n]` suffix or Discord drops it.
async function postAttachment(channelId, filePath, content = "", components = undefined) {
  const fs = require("node:fs");
  const path = require("node:path");
  const filename = path.basename(filePath);
  const bytes = fs.readFileSync(filePath);

  const buildBody = () => {
    const body = new FormData();
    body.append(
      "payload_json",
      JSON.stringify({ content, attachments: [{ id: 0, filename }], ...(components ? { components } : {}) }),
    );
    body.append("files[0]", new Blob([bytes]), filename);
    return body;
  };

  return discordRequest(`/channels/${channelId}/messages`, { method: "POST", formData: buildBody });
}

// `allowedMentions` opt-in: omitting it lets Discord parse everything in
// `content`, wrong for anything a player typed (see proxy.js, intercom.js).
// `embeds` is Discord's own JSON shape; only torture.js sends one.
async function postMessage(channelId, content, components = undefined, allowedMentions = undefined, embeds = undefined) {
  return discordRequest(`/channels/${channelId}/messages`, {
    method: "POST",
    body: {
      content,
      ...(components ? { components } : {}),
      ...(allowedMentions ? { allowed_mentions: allowedMentions } : {}),
      ...(embeds?.length ? { embeds } : {}),
    },
  });
}

// Posts text as one message, or several in order if it exceeds Discord's
// 2000-char limit. Sequential and throws on the first chunk that fails.
async function postMessageBatched(channelId, text) {
  for (const chunk of chunkMessage(text)) {
    await postMessage(channelId, chunk);
  }
}

// Rewrites a forum post's STARTER message (id == thread id) in place.
async function editMessage(channelId, messageId, content, components = undefined) {
  return discordRequest(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: components ? { content, components } : { content },
  });
}

// Pins a MESSAGE via the real /pins endpoint — not to be confused with
// THREAD_FLAG_PINNED in threads.js. Idempotent: PUT returns 204 either way.
async function pinMessage(channelId, messageId) {
  return discordRequest(`/channels/${channelId}/pins/${messageId}`, {
    method: "PUT",
    allow404: true,
  });
}

async function deleteMessage(channelId, messageId) {
  return discordRequest(`/channels/${channelId}/messages/${messageId}`, { method: "DELETE", allow404: true });
}

// Paginates GET .../messages (newest-first per page) until short of a full
// page, then reverses to chronological order. `before` seeds Discord's own
// cursor to bound the walk — see snowflakeForTimestamp and messageWipe.js.
async function fetchAllMessages(channelId, { before: startBefore } = {}) {
  const pageSize = 100;
  const messages = [];
  let before = startBefore;

  for (;;) {
    const query = new URLSearchParams({ limit: String(pageSize) });
    if (before) query.set("before", before);
    const page = await discordRequest(`/channels/${channelId}/messages?${query}`);
    if (!page || page.length === 0) break;
    messages.push(...page);
    before = page[page.length - 1].id;
    if (page.length < pageSize) break;
  }

  return messages.reverse();
}

// Discord's epoch: the upper 42 bits of a message id are ms since 2015-01-01.
const DISCORD_EPOCH = 1_420_070_400_000n;
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// Inverse of messageTimestamp: the smallest snowflake a message at `ms`
// could have — usable anywhere a before/after cursor is accepted.
function snowflakeForTimestamp(ms) {
  return String((BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n);
}

// Cap on one-at-a-time deletes for over-age messages, since each is its own
// request.
const OLD_MESSAGE_DELETE_CAP = 50;

function messageTimestamp(messageId) {
  try {
    return Number((BigInt(messageId) >> 22n) + DISCORD_EPOCH);
  } catch {
    return null;
  }
}

// Bulk-delete rejects the WHOLE batch if any id is over 14 days old, so ids
// split by age: young ones bulk-delete together, old ones go one at a time.
async function bulkDeleteMessages(channelId, messageIds) {
  const cutoff = Date.now() - BULK_DELETE_MAX_AGE_MS;
  const young = [];
  const old = [];
  for (const id of messageIds) {
    const at = messageTimestamp(id);
    // An unparseable id is treated as young; Discord rejects it if wrong.
    (at !== null && at < cutoff ? old : young).push(id);
  }

  for (let i = 0; i < young.length; i += 100) {
    const chunk = young.slice(i, i + 100);
    if (chunk.length === 1) {
      await deleteMessage(channelId, chunk[0]);
    } else if (chunk.length > 1) {
      await discordRequest(`/channels/${channelId}/messages/bulk-delete`, {
        method: "POST",
        body: { messages: chunk },
      });
    }
  }

  if (old.length === 0) return;

  const deleting = old.slice(0, OLD_MESSAGE_DELETE_CAP);
  console.warn(
    `Bulk delete: ${old.length} message(s) in ${channelId} are over 14 days old and can't be ` +
      `batched. Deleting ${deleting.length} one at a time` +
      (old.length > deleting.length ? `; ${old.length - deleting.length} left for the next run.` : "."),
  );
  for (const id of deleting) {
    await deleteMessage(channelId, id);
  }
}

// Everything in a channel or thread except one nominated message. `before`
// bounds it the way the Dawn wipe's cutoff bounds every other clear.
async function clearMessagesExcept(channelId, keepId, { before } = {}) {
  const messages = await fetchAllMessages(channelId, { before });
  const toDelete = messages.filter((m) => m.id !== keepId).map((m) => m.id);
  if (toDelete.length === 0) return;
  await bulkDeleteMessages(channelId, toDelete);
}

module.exports = {
  chunkMessage,
  postAttachment,
  postMessage,
  postMessageBatched,
  editMessage,
  pinMessage,
  deleteMessage,
  fetchAllMessages,
  snowflakeForTimestamp,
  messageTimestamp,
  bulkDeleteMessages,
  clearMessagesExcept,
};
