// One snapshot of the guild, taken once per mirror run and handed to diff.js.
//
// The mirror never asks Discord "does this exist?" one object at a time — that
// is how the channel doctor earns its REST bill. Three list calls give the
// whole picture, and everything after that is a map lookup.
//
// Two indexes per kind: by id, for "the column points at a real object", and by
// NAME, for adoption. Adoption is the reason the mirror can be killed halfway
// through and re-run without cutting a second copy of everything, so the name
// key has to be the name Discord actually stored, not the name we asked for.
const { getGuildRoles, getGuildChannels, fetchActiveThreads } = require("../discordRest");

const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;

// Discord rewrites a text channel's name on the way in: lowercased, spaces
// become hyphens, punctuation it does not allow is dropped, runs of hyphens
// collapse, and the whole thing is cut at 100 characters. Ask for "The Old
// Mill!" and you get back "the-old-mill". Adoption compares names, so it has
// to compare them the way Discord stored them — otherwise every run looks at
// "The Old Mill", finds nothing called that, and creates another channel.
//
// Categories are NOT normalized (they keep their case and spaces), so only
// text channels and threads go through this.
function normalizeChannelName(name) {
  return String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    // Unicode letters and digits survive, plus the two punctuation marks
    // Discord keeps. Everything else is dropped rather than replaced, which is
    // what turns "27.065" into "27065".
    .replace(/[^\p{L}\p{N}_-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

// The adoption key for a channel or category: type, parent, name. Two channels
// with the same name under different categories are different objects, and a
// category and a text channel called the same thing are too.
function channelKey(type, parentId, name) {
  const label = Number(type) === CHANNEL_TYPE_CATEGORY ? String(name ?? "") : normalizeChannelName(name);
  return `${Number(type)}:${parentId ?? ""}:${label}`;
}

// A thread's name is not normalized by Discord at all — it is stored as typed,
// cut at 100 characters, which is exactly what roomThreads.js sends.
function threadKey(parentId, name) {
  return `${parentId ?? ""}:${String(name ?? "").slice(0, 100)}`;
}

// Multi-map: a key holds every match, so diff.js can tell "one match, adopt it"
// from "two matches, refuse and say so".
function pushInto(map, key, value) {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

async function loadLiveSnapshot({ includeThreads = true } = {}) {
  // Sequential on purpose. Three reads is not a fan-out worth risking a bucket
  // over, and the thread list is the one allowed to fail.
  const roles = (await getGuildRoles()) ?? [];
  const channels = (await getGuildChannels()) ?? [];
  let threads = [];
  let threadsFetched = false;
  if (includeThreads) {
    try {
      threads = (await fetchActiveThreads()) ?? [];
      threadsFetched = true;
    } catch (err) {
      // An archived-thread fallback is the sync's problem, not the snapshot's.
      // Say so and let diff.js leave thread ops alone rather than guessing.
      console.error("mirror: active-thread snapshot failed:", err.message ?? err);
    }
  }

  const rolesById = new Map();
  const rolesByName = new Map();
  for (const role of roles) {
    rolesById.set(role.id, role);
    pushInto(rolesByName, role.name, role);
  }

  const channelsById = new Map();
  const channelsByKey = new Map();
  for (const channel of channels) {
    channelsById.set(channel.id, channel);
    pushInto(channelsByKey, channelKey(channel.type, channel.parent_id, channel.name), channel);
  }

  const threadsById = new Map();
  const threadsByKey = new Map();
  for (const thread of threads) {
    threadsById.set(thread.id, thread);
    pushInto(threadsByKey, threadKey(thread.parent_id, thread.name), thread);
  }

  return {
    roles,
    channels,
    threads,
    threadsFetched,
    rolesById,
    rolesByName,
    channelsById,
    channelsByKey,
    threadsById,
    threadsByKey,
  };
}

// An empty snapshot, for a dry run with no guild to look at (LOCAL_MODE, or a
// test). Everything reads as "nothing exists yet".
function emptySnapshot() {
  return {
    roles: [],
    channels: [],
    threads: [],
    threadsFetched: true,
    rolesById: new Map(),
    rolesByName: new Map(),
    channelsById: new Map(),
    channelsByKey: new Map(),
    threadsById: new Map(),
    threadsByKey: new Map(),
  };
}

module.exports = {
  loadLiveSnapshot,
  emptySnapshot,
  normalizeChannelName,
  channelKey,
  threadKey,
  CHANNEL_TYPE_TEXT,
  CHANNEL_TYPE_CATEGORY,
};
