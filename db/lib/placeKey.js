// Place keys: the one string that names WHERE something was said, shared by
// the two faces.
//
// A Discord channel id is not enough on its own — a Location has a channel, a
// Room has a thread, a Conversation has a thread, and a Zone has a summary
// channel, and the live feed has to subscribe to one of those without caring
// which kind it is. So every row carries a key of the form `loc:<id>`,
// `room:<id>`, `conv:<id>`, `zone:<id>` or `net:<slug>`, a snapshot string with
// no FK behind it, exactly like every other id column on ArchiveEntry.
//
// `net:` is the odd one: it names a SPECIAL CHANNEL (db/lib/specialChannels.js)
// — a radio net — and its id is the registry slug rather than a row id, because
// there is no row. It exists so a radio is a place on the web at all: without a
// key, a message typed on a frequency is archived against nowhere, cannot be
// listed by feedAccess, cannot be subscribed to, and cannot be relayed back to
// Discord by the outbox.
//
// Takes `prisma` as a parameter rather than requiring db/index.js, same reason
// as archive.js and dm.js: db/index.js imports this module, so requiring it
// back would resolve to a partial exports object.

const { SPECIAL_CHANNELS } = require("./specialChannels");

function placeKeyForLocation(locationId) {
  return locationId ? `loc:${locationId}` : null;
}

function placeKeyForRoom(roomId) {
  return roomId ? `room:${roomId}` : null;
}

function placeKeyForConversation(playerThreadId) {
  return playerThreadId ? `conv:${playerThreadId}` : null;
}

function placeKeyForZone(zoneId) {
  return zoneId ? `zone:${zoneId}` : null;
}

// The id here is the registry slug, not a row id — a special channel has no row.
function placeKeyForNet(slug) {
  return slug ? `net:${slug}` : null;
}

// Memoised for a minute, the way archive.js#currentGameId is: this sits
// inline with the hottest path in the bot (every proxied message), and the
// channel layout only changes when db:sync-zones runs.
const CHANNEL_TTL_MS = 60 * 1000;
const channelMemo = new Map(); // channelId -> { key, at }

function forgetPlaceKeys() {
  channelMemo.clear();
}

// `channelId` is the THREAD's own id when the message was said inside a
// thread, matching what resolveChannelContext stores. `parentId` is the
// channel that thread hangs under, used only as a fallback so a thread nobody
// has a row for still resolves to the Location around it.
async function placeKeyForChannel(prisma, { channelId, parentId = null } = {}) {
  if (!channelId) return null;

  const cached = channelMemo.get(channelId);
  if (cached && Date.now() - cached.at < CHANNEL_TTL_MS) return cached.key;

  const key = await resolveChannelKey(prisma, channelId, parentId);
  channelMemo.set(channelId, { key, at: Date.now() });
  return key;
}

// Which special channel this id is, if any. One GameConfig read, shared by the
// two directions below.
async function netKeyForChannel(prisma, channelId) {
  if (!channelId) return null;
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (!config) return null;
  const entry = SPECIAL_CHANNELS.find((c) => config[c.configKey] && config[c.configKey] === channelId);
  return entry ? placeKeyForNet(entry.slug) : null;
}

async function resolveChannelKey(prisma, channelId, parentId) {
  // Ordered cheapest-first by how often each kind is written to. All four are
  // indexed lookups, so the cost of a miss is small.
  const location = await prisma.location.findFirst({
    where: { discordChannelId: channelId },
    select: { id: true },
  });
  if (location) return placeKeyForLocation(location.id);

  const room = await prisma.room.findFirst({
    where: { discordThreadId: channelId },
    select: { id: true },
  });
  if (room) return placeKeyForRoom(room.id);

  const conversation = await prisma.playerThread.findFirst({
    where: { threadId: channelId },
    select: { id: true },
  });
  if (conversation) return placeKeyForConversation(conversation.id);

  const zone = await prisma.zone.findFirst({
    where: { discordSummaryChannelId: channelId },
    select: { id: true },
  });
  if (zone) return placeKeyForZone(zone.id);

  // A special channel (db/lib/specialChannels.js) — a radio net. It has no
  // row of its own, so it is matched against the ids on GameConfig. Last of
  // the direct lookups because it is the rarest, and the whole resolve is
  // memoised per channel by placeKeyForChannel above.
  const netKey = await netKeyForChannel(prisma, channelId);
  if (netKey) return netKey;

  // A thread nobody has a row for — a forum scene, say — still belongs to the
  // Location its parent channel is, which is the place a reader would expect
  // to find it under.
  if (parentId && parentId !== channelId) {
    const parent = await prisma.location.findFirst({
      where: { discordChannelId: parentId },
      select: { id: true },
    });
    if (parent) return placeKeyForLocation(parent.id);
  }

  return null;
}

// The snapshot columns an ArchiveEntry carries beside its place key, resolved
// from the key alone. The Discord proxy gets these free from the channel it
// was typed in (bot/src/lib/channels.js#resolveChannelContext); a web send has
// only the key, and the two must agree or /archive renders the same scene two
// different ways.
//
// `channelKind` matches what the proxy stamps: "location" for a Location
// channel and for the threads hanging off it, "summary" for a zone's
// #summary.
async function archiveContextForPlaceKey(prisma, placeKey) {
  const empty = { zoneId: null, zoneName: null, channelKind: null, threadName: null };
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return empty;

  if (parsed.kind === "loc") {
    const location = await prisma.location.findUnique({
      where: { id: parsed.id },
      select: { zoneId: true, zone: { select: { name: true } } },
    });
    if (!location) return empty;
    return { zoneId: location.zoneId, zoneName: location.zone?.name ?? null, channelKind: "location", threadName: null };
  }

  if (parsed.kind === "room") {
    const room = await prisma.room.findUnique({
      where: { id: parsed.id },
      select: { name: true, location: { select: { zoneId: true, zone: { select: { name: true } } } } },
    });
    if (!room) return empty;
    return {
      zoneId: room.location?.zoneId ?? null,
      zoneName: room.location?.zone?.name ?? null,
      channelKind: "location",
      threadName: room.name,
    };
  }

  if (parsed.kind === "conv") {
    const conversation = await prisma.playerThread.findUnique({
      where: { id: parsed.id },
      select: { name: true, location: { select: { zoneId: true, zone: { select: { name: true } } } } },
    });
    if (!conversation) return empty;
    return {
      zoneId: conversation.location?.zoneId ?? null,
      zoneName: conversation.location?.zone?.name ?? null,
      channelKind: "location",
      threadName: conversation.name,
    };
  }

  // A radio net stands in no zone at all, and its channelKind is the registry
  // slug — the same string bot/src/lib/channels.js stamps on a message typed
  // there, so /archive files both faces' lines as one scene.
  if (parsed.kind === "net") {
    const entry = SPECIAL_CHANNELS.find((c) => c.slug === parsed.id);
    if (!entry) return empty;
    return { zoneId: null, zoneName: null, channelKind: entry.slug, threadName: null };
  }

  const zone = await prisma.zone.findUnique({ where: { id: parsed.id }, select: { id: true, name: true } });
  if (!zone) return empty;
  return { zoneId: zone.id, zoneName: zone.name, channelKind: "summary", threadName: null };
}

// The other direction: what a key points at. Returns { kind, id } or null.
function parsePlaceKey(placeKey) {
  if (typeof placeKey !== "string") return null;
  const at = placeKey.indexOf(":");
  if (at <= 0) return null;
  const kind = placeKey.slice(0, at);
  const id = placeKey.slice(at + 1);
  if (!id) return null;
  if (!["loc", "room", "conv", "zone", "net"].includes(kind)) return null;
  return { kind, id };
}

// A SCENE is somewhere people are standing together and can hear each other:
// a Room thread or a Conversation. Not a Location, which is the street's
// scenery and takes no voice at all — its members hold no Send there, and
// what happens on it happens through the anchor's buttons. Not a zone
// #summary either, which is a broadcast rather than a place anybody stands in.
//
// This is the gate for the three moment-to-moment verbs — shout, play, roll —
// and it lives here so the two faces cannot drift: the bot resolves a channel
// to a key with placeKeyForChannel above and asks this, the web asks it of the
// key the browser sent. Before it, Discord and the web disagreed about where
// each of the three was legal, and the web's half was a hidden menu entry with
// nothing behind it.
function isScenePlaceKey(placeKey) {
  const kind = parsePlaceKey(placeKey)?.kind;
  return kind === "room" || kind === "conv";
}

// Where on Discord a place key points, for the outbox: the channel a webhook
// belongs to, plus the thread to post into when there is one.
//
// A webhook cannot be created on a thread — Discord hangs it off the parent
// channel and the execute call carries `?thread_id=`. So `channelId` here is
// always the channel that owns the webhook, and `threadId` is non-null only
// for a Room or a Conversation.
async function discordTargetForPlaceKey(prisma, placeKey) {
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return null;

  if (parsed.kind === "loc") {
    const location = await prisma.location.findUnique({
      where: { id: parsed.id },
      select: { discordChannelId: true },
    });
    return location?.discordChannelId ? { channelId: location.discordChannelId, threadId: null } : null;
  }

  if (parsed.kind === "room") {
    const room = await prisma.room.findUnique({
      where: { id: parsed.id },
      select: { discordThreadId: true, location: { select: { discordChannelId: true } } },
    });
    if (!room?.discordThreadId || !room.location?.discordChannelId) return null;
    return { channelId: room.location.discordChannelId, threadId: room.discordThreadId };
  }

  if (parsed.kind === "conv") {
    const conversation = await prisma.playerThread.findUnique({
      where: { id: parsed.id },
      select: { threadId: true, location: { select: { discordChannelId: true } } },
    });
    if (!conversation?.threadId || !conversation.location?.discordChannelId) return null;
    return { channelId: conversation.location.discordChannelId, threadId: conversation.threadId };
  }

  if (parsed.kind === "zone") {
    const zone = await prisma.zone.findUnique({
      where: { id: parsed.id },
      select: { discordSummaryChannelId: true },
    });
    return zone?.discordSummaryChannelId ? { channelId: zone.discordSummaryChannelId, threadId: null } : null;
  }

  // The web -> Discord half of a radio net. A net is a plain channel, so it
  // carries no thread, the way a Location does not.
  if (parsed.kind === "net") {
    const entry = SPECIAL_CHANNELS.find((c) => c.slug === parsed.id);
    if (!entry) return null;
    const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
    const channelId = config?.[entry.configKey];
    return channelId ? { channelId, threadId: null } : null;
  }

  return null;
}

module.exports = {
  placeKeyForNet,
  placeKeyForChannel,
  discordTargetForPlaceKey,
  archiveContextForPlaceKey,
  placeKeyForLocation,
  placeKeyForRoom,
  placeKeyForConversation,
  placeKeyForZone,
  parsePlaceKey,
  isScenePlaceKey,
  forgetPlaceKeys,
};
