// Place keys: the one string naming WHERE something was said, shared by both
// faces — `loc:<id>`, `room:<id>`, `conv:<id>`, `zone:<id>`, `net:<slug>` or
// `dead:main`, a snapshot string with no FK behind it. `net:` names a SPECIAL
// CHANNEL (db/lib/specialChannels.js) by its registry slug, since there is no
// row. `dead:` is DEADCHAT (db/lib/deadchat.js) — one instance, so the id half
// is the constant "main" rather than anything looked up.
// Takes `prisma` as a parameter rather than requiring db/index.js: that would resolve to a partial exports object.

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

function placeKeyForNet(slug) {
  return slug ? `net:${slug}` : null;
}

// Deadchat: the room the dead talk in (db/lib/deadchat.js). There is exactly one, so this is a
// constant rather than a function of anything — exported so nobody hand-writes the string.
const DEADCHAT_PLACE_KEY = "dead:main";

// Memoised for a minute (like archive.js#currentGameId): hot path, layout rarely changes.
const CHANNEL_TTL_MS = 60 * 1000;
const channelMemo = new Map(); // channelId -> { key, at }

function forgetPlaceKeys() {
  channelMemo.clear();
}

// `channelId` is the THREAD's own id inside a thread; `parentId` is the fallback channel.
async function placeKeyForChannel(prisma, { channelId, parentId = null } = {}) {
  if (!channelId) return null;

  const cached = channelMemo.get(channelId);
  if (cached && Date.now() - cached.at < CHANNEL_TTL_MS) return cached.key;

  const key = await resolveChannelKey(prisma, channelId, parentId);
  channelMemo.set(channelId, { key, at: Date.now() });
  return key;
}

// Which standing channel this id is, if any — Deadchat or one of the radio nets. Both live in
// GameConfig columns rather than rows, so they share the one read: a second findUnique here would
// double the cost of every channel resolve for the rarest arm of it.
async function specialKeyForChannel(prisma, channelId) {
  if (!channelId) return null;
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (!config) return null;
  if (config.deadchatChannelId && config.deadchatChannelId === channelId) return DEADCHAT_PLACE_KEY;
  const entry = SPECIAL_CHANNELS.find((c) => config[c.configKey] && config[c.configKey] === channelId);
  return entry ? placeKeyForNet(entry.slug) : null;
}

async function resolveChannelKey(prisma, channelId, parentId) {
  // Ordered cheapest-first; all four are indexed lookups.
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

  // Deadchat and the radio nets have no row, so they are last and rarest.
  const specialKey = await specialKeyForChannel(prisma, channelId);
  if (specialKey) return specialKey;

  // A thread nobody has a row for still belongs to its parent's Location.
  if (parentId && parentId !== channelId) {
    const parent = await prisma.location.findFirst({
      where: { discordChannelId: parentId },
      select: { id: true },
    });
    if (parent) return placeKeyForLocation(parent.id);
  }

  return null;
}

// Snapshot columns an ArchiveEntry carries beside its place key, resolved from
// the key alone (bot/src/lib/channels.js#resolveChannelContext gets these free);
// only the key, and the two must agree or /archive renders the same scene two
// different ways.
async function archiveContextForPlaceKey(prisma, placeKey) {
  const empty = { zoneId: null, zoneName: null, channelKind: null, threadName: null };
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return empty;

  // Deadchat belongs to no zone and needs no lookup. Its own channelKind is what lets /archive
  // keep it apart from the scenes — it is out-of-character talk, not part of the world's record.
  if (parsed.kind === "dead") {
    return { zoneId: null, zoneName: null, channelKind: "deadchat", threadName: null };
  }

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

  // A radio net's channelKind is the registry slug, matching bot/src/lib/channels.js's stamp.
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
  if (!["loc", "room", "conv", "zone", "net", "dead"].includes(kind)) return null;
  return { kind, id };
}

// Normalises a logAudit call site's place into {locationId, roomId} for
// AuditLog (schema.prisma): {locationId,roomId}, a character-ish object (no
// room, since the server never learns which thread a character-sheet button
// was pressed from), or a place key string. A room row ALWAYS carries its
// location too, derived from Room.locationId. zone:/net:/dead: resolve to nulls
// — none of them sits at a Location, so falling through to `empty` is the answer,
// not an arm somebody still needs to write.
async function placePairForAudit(prisma, place) {
  const empty = { locationId: null, roomId: null };
  if (!place) return empty;

  if (typeof place === "object" && "locationId" in place) {
    return { locationId: place.locationId ?? null, roomId: place.roomId ?? null };
  }

  if (typeof place !== "string") return empty;

  const parsed = parsePlaceKey(place);
  if (!parsed) return empty;

  if (parsed.kind === "loc") return { locationId: parsed.id, roomId: null };

  if (parsed.kind === "room") {
    const room = await prisma.room.findUnique({ where: { id: parsed.id }, select: { locationId: true } });
    return room ? { locationId: room.locationId, roomId: parsed.id } : empty;
  }

  if (parsed.kind === "conv") {
    const conversation = await prisma.playerThread.findUnique({
      where: { id: parsed.id },
      select: { locationId: true, roomId: true },
    });
    if (!conversation) return empty;
    return { locationId: conversation.locationId, roomId: conversation.roomId ?? null };
  }

  return empty;
}

// A SCENE is a Room thread or a Conversation — not a Location (no voice; the
// anchor's buttons handle it) and not a zone #summary (a broadcast). Gate for
// shout/play/roll, shared so the two faces cannot drift on where each is legal.
//
// Deadchat is deliberately NOT a scene. It is out-of-character talk among people no longer in the
// world, so a shout, a performance or a die roll there would be a mechanic the game does not have.
function isScenePlaceKey(placeKey) {
  const kind = parsePlaceKey(placeKey)?.kind;
  return kind === "room" || kind === "conv";
}

// Where on Discord a place key points, for the outbox. A webhook cannot be
// created on a thread, so `channelId` is always the owning channel and
// `threadId` is non-null only for a Room or Conversation.
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

  // Deadchat is a plain channel too, and its id is a GameConfig column like a net's.
  if (parsed.kind === "dead") {
    const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
    return config?.deadchatChannelId ? { channelId: config.deadchatChannelId, threadId: null } : null;
  }

  // A net is a plain channel, so it carries no thread.
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
  DEADCHAT_PLACE_KEY,
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
  placePairForAudit,
};
