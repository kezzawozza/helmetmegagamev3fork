// syncZones — what is left of the old destructive zones sync.
//
// `syncZonesFromYaml` used to be five passes: parse+upsert, Discord
// provisioning, every-run reconcile, prune, and channel ordering. All five are
// gone. Standing a place up from docs/zones.yaml is now `db/lib/importZones.js`
// (additive, never deletes — `npm run db:import-zones`), and keeping Discord
// true to the database is `db/lib/discordMirror/` (`npm run db:mirror`, and the
// bot/turn/queue triggers that call it for you). `syncZonesFromYaml` survives
// only as a thin, deprecated shim over both, for `finishGameWipe`
// (web/app/(app)/gm/dev/actions.js) — the Restart Game flow still calls it,
// until the phase that rewrites Restart Game to keep Discord structure lands.
//
// What's left below are the three refresh helpers other live callers still
// use — a gate flipping, a shuttle taking off, the Depot's live line changing
// — none of which are the sync's job to own, and none of which delete or
// create structure.
const { buildRoomBody } = require("./bodies");
const { roomComponents, syncLocationAnchor } = require("./roomThreads");
const { hashBody } = require("./shared");
const { loadLiveStates } = require("../roomLive");
const { WATCHTOWER_ROOM_SLUGS } = require("../roomStarterRow");
const { editMessage, chunkMessage } = require("../discordRest");

// Deprecated: import (additive, apply) then a structure mirror pass. Kept
// working for finishGameWipe only — nothing else should call this.
async function syncZonesFromYaml(prisma) {
  const { importZonesFromYaml } = require("../importZones");
  const { runDiscordMirror } = require("../discordMirror");
  const importReport = await importZonesFromYaml(prisma, { apply: true });
  const mirrorResult = await runDiscordMirror(prisma, { apply: true, scope: "structure" });
  return { importReport, mirrorResult };
}

// Reposts one location's anchor from current state. The gate button handler
// calls this after flipping a link, on BOTH endpoints — the gate has a button
// on each side and shutting it from one must not leave the other reading
// "Open".
async function refreshLocationAnchor(prisma, locationId) {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) return "skipped";
  const rooms = await prisma.room.findMany({
    where: { locationId },
    orderBy: { sortOrder: "asc" },
  });
  return syncLocationAnchor(prisma, location, rooms);
}

// Re-renders the room starters matching `where` and edits the ones whose post
// actually moved. Two callers, below: a live key changing (the Depot's shuttle
// buttons, the turn pass, the Dev Panel) and a gate flipping. Both want the
// same thing — the starter as syncRoomThread would draw it right now.
//
// One loop rather than two on purpose. The hash MUST be composed exactly as
// syncRoomThread composes it, or a starter reposts on every call forever, and
// that recipe is a trap worth having in a single place. roomComponents is what
// guarantees it.
//
// Edits in place rather than going through syncRoomThread: a room whose thread
// is missing is a job for the mirror or the channel doctor, not for a shuttle
// taking off or a gate closing.
async function refreshRoomStarters(prisma, where, label) {
  const rooms = await prisma.room.findMany({ where });
  if (!rooms.length) return 0;

  const liveKeys = [...new Set(rooms.map((r) => r.live).filter(Boolean))];
  const states = liveKeys.length ? await loadLiveStates(prisma, liveKeys) : new Map();

  let edited = 0;
  for (const room of rooms) {
    if (!room.discordThreadId || !room.starterMessageId) continue;
    const body = buildRoomBody(room, room.live ? states.get(room.live) : null);
    const components = await roomComponents(prisma, room, room.locationId);
    const hash = hashBody(body + JSON.stringify(components));
    if (room.postHash === hash) continue;
    try {
      await editMessage(room.discordThreadId, room.starterMessageId, chunkMessage(body)[0], components);
    } catch (err) {
      console.error(`${label} room refresh failed (${room.slug}):`, err.message);
      continue;
    }
    await prisma.room.update({ where: { id: room.id }, data: { postHash: hash } });
    edited += 1;
  }
  return edited;
}

// Every room carrying one live key.
async function refreshLiveRooms(prisma, key) {
  return refreshRoomStarters(prisma, { live: key }, "live");
}

// The watchtower that carries this location's gate button — the room-thread
// twin of refreshLocationAnchor, and every caller of that one calls this too.
// The anchor no longer renders a gate at all, so this is the only repost that
// shows a flip anywhere. A watchtower whose thread is gone therefore shows it
// nowhere until the mirror or the doctor puts the thread back, which is the
// trade for having exactly one place the button lives.
async function refreshGateRooms(prisma, locationId) {
  return refreshRoomStarters(
    prisma,
    { locationId, slug: { in: [...WATCHTOWER_ROOM_SLUGS] } },
    "gate",
  );
}

module.exports = {
  syncZonesFromYaml,
  refreshLiveRooms,
  refreshLocationAnchor,
  refreshGateRooms,
};
