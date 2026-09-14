// syncZones Room threads: one thread per room, plus the Location anchor
// message. Split out of db/lib/syncZones.js — see that file.
const {
  startThread,
  startPrivateThread,
  patchThread,
  editMessage,
  postMessage,
  clearMessagesExcept,
  chunkMessage,
  pinMessage,
  getChannel,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
} = require("../discordRest");
const { locationAnchorRows, locationGateRow } = require("../locationAnchorRow");
const { roomStarterRow, WATCHTOWER_ROOM_SLUGS } = require("../roomStarterRow");
const { linksFor, endpoints, gateOperable } = require("../locationGraph");
const { hashBody } = require("./shared");
const { buildRoomBody, buildAnchorBody } = require("./bodies");

// --- Room threads ------------------------------------------------------

// Adopt an existing thread instead of creating a duplicate (a retried
// create Discord already applied).
async function findExistingThread(channelId, title, snapshot, kind) {
  const active = await listActiveThreadsForChannel(channelId, snapshot);
  const found = active.find((t) => t.name === title);
  if (found) return found;
  const archived =
    kind === "PRIVATE"
      ? await listArchivedPrivateThreads(channelId)
      : await listArchivedPublicThreads(channelId);
  return archived.find((t) => t.name === title) ?? null;
}

// First chunk becomes the starter (pinned in-thread), the rest follow.
async function writeRoomStarter(threadId, chunks, components) {
  const starter = await postMessage(threadId, chunks[0], components);
  for (const chunk of chunks.slice(1)) await postMessage(threadId, chunk);
  // Best-effort: a pin failure must never abort the sync.
  await pinMessage(threadId, starter.id).catch((err) =>
    console.error(`Room starter pin failed (${threadId}):`, err.message),
  );
  return starter.id;
}

// One thread per room, sync-owned: starter = the room body, reconciled by
// hash. Never locked; the message wipe clears replies but never the starter.
// Returns "created" | "updated" | "unchanged" | "skipped". Rooms carry NO
// slowmode (the 5-minute one belongs to #summary alone); zero is asserted on
// every pass the same way `archived: false` is, since Discord keeps a
// thread's rate limit per thread and nothing else would ever clear it.
const ROOM_SLOWMODE_SECONDS = 0;

async function syncRoomThread(prisma, room, location, snapshot, liveState) {
  if (!location?.discordChannelId) return "skipped";

  const body = buildRoomBody(room, liveState);
  // Hashed with its button row, as the anchor is: a gate's open/shut state is
  // INSIDE that row, so the button re-renders after a flip.
  const components = await roomComponents(prisma, room, location.id);
  const hash = hashBody(body + JSON.stringify(components));
  const chunks = chunkMessage(body);
  const title = room.name.slice(0, 100);

  let existing = null;
  if (room.discordThreadId) {
    existing = await getChannel(room.discordThreadId, { allow404: true });
  }
  if (existing && room.starterMessageId && room.postHash === hash) {
    // The cheap re-assert that keeps a room visible after seven idle days.
    if (existing.thread_metadata?.archived || existing.rate_limit_per_user !== ROOM_SLOWMODE_SECONDS) {
      await patchThread(room.discordThreadId, {
        archived: false,
        rate_limit_per_user: ROOM_SLOWMODE_SECONDS,
      });
    }
    return "unchanged";
  }

  if (!existing) {
    const adopted = await findExistingThread(location.discordChannelId, title, snapshot, room.kind);
    let thread = adopted;
    if (!thread) {
      thread =
        room.kind === "PRIVATE"
          ? await startPrivateThread(location.discordChannelId, title, 10080, ROOM_SLOWMODE_SECONDS)
          : await startThread(location.discordChannelId, title, 10080, ROOM_SLOWMODE_SECONDS);
    } else {
      await patchThread(thread.id, { archived: false, rate_limit_per_user: ROOM_SLOWMODE_SECONDS });
      await clearMessagesExcept(thread.id, null);
    }
    const starterMessageId = await writeRoomStarter(thread.id, chunks, components);
    await prisma.room.update({
      where: { id: room.id },
      data: { discordThreadId: thread.id, starterMessageId, postHash: hash },
    });
    room.discordThreadId = thread.id;
    room.starterMessageId = starterMessageId;
    room.postHash = hash;
    return adopted ? "updated" : "created";
  }

  // Rewrite in place: unarchive, drop everything but the starter, edit it.
  await patchThread(room.discordThreadId, { archived: false, rate_limit_per_user: ROOM_SLOWMODE_SECONDS });
  let starterMessageId = room.starterMessageId;
  if (starterMessageId) {
    await clearMessagesExcept(room.discordThreadId, starterMessageId);
    try {
      await editMessage(room.discordThreadId, starterMessageId, chunks[0], components);
      for (const chunk of chunks.slice(1)) await postMessage(room.discordThreadId, chunk);
    } catch (err) {
      if (err?.status !== 404) throw err;
      starterMessageId = null;
    }
  }
  if (!starterMessageId) {
    await clearMessagesExcept(room.discordThreadId, null);
    starterMessageId = await writeRoomStarter(room.discordThreadId, chunks, components);
  }
  await patchThread(room.discordThreadId, {
    name: title,
    archived: false,
    rate_limit_per_user: ROOM_SLOWMODE_SECONDS,
  });
  await prisma.room.update({
    where: { id: room.id },
    data: { starterMessageId, postHash: hash },
  });
  room.starterMessageId = starterMessageId;
  room.postHash = hash;
  return "updated";
}

// Reads the graph rather than the sync's own state, since the button handler
// refreshes an anchor too and has no sync state to hand.
async function gatesFor(prisma, locationId) {
  const links = await linksFor(prisma, locationId);
  return links
    .filter((link) => gateOperable(link))
    .map((link) => ({
      linkId: link.id,
      isOpen: link.isOpen,
      farName: endpoints(link, locationId).far.name,
    }))
    .sort((x, y) => x.farName.localeCompare(y.farName));
}

// A Room's starter row, plus — for watchtowers — one Open/Close button per
// modular gate on the Location, the ONLY place a gate button renders
// (db/lib/roomStarterRow.js#WATCHTOWER_ROOM_SLUGS). A separate action row
// keeps Storage/Intercom/Turret/Bell clear of Discord's five-per-row cap.
async function roomComponents(prisma, room, locationId) {
  const rows = [roomStarterRow(room)];
  if (WATCHTOWER_ROOM_SLUGS.has(room.slug)) {
    rows.push(locationGateRow(await gatesFor(prisma, locationId)));
  }
  return rows.filter(Boolean);
}

// The pinned anchor message in a location's channel. Hash-gated on body +
// components; a message a GM deleted by hand is reposted. The gate button is
// on the watchtower's starter post instead (roomComponents above), so nobody
// drops a portcullis from the open road.
async function syncLocationAnchor(prisma, location, rooms) {
  if (!location.discordChannelId) return "skipped";

  const body = buildAnchorBody(location, rooms);
  // Whole set of rows, not just the id: Noticeboard is conditional on
  // `attributes` (db/lib/noticeboard.js), Travel pushed a second row.
  const components = locationAnchorRows(location);
  const hash = hashBody(`${body} ${JSON.stringify(components)}`);

  if (location.anchorMessageId && location.anchorHash === hash) return "unchanged";

  if (location.anchorMessageId) {
    try {
      await editMessage(location.discordChannelId, location.anchorMessageId, body, components);
      await prisma.location.update({ where: { id: location.id }, data: { anchorHash: hash } });
      location.anchorHash = hash;
      return "updated";
    } catch (err) {
      if (err?.status !== 404) throw err;
      // Fall through and repost.
    }
  }

  const message = await postMessage(location.discordChannelId, body, components);
  await pinMessage(location.discordChannelId, message.id).catch((err) =>
    console.error(`Anchor pin failed for ${location.slug}:`, err.message),
  );
  await prisma.location.update({
    where: { id: location.id },
    data: { anchorMessageId: message.id, anchorHash: hash },
  });
  location.anchorMessageId = message.id;
  location.anchorHash = hash;
  return "created";
}

module.exports = {
  syncRoomThread,
  gatesFor,
  roomComponents,
  syncLocationAnchor,
};
