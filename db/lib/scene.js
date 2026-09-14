// A line the WORLD says, written down. db/lib/ambientLine.js is how one of
// these LOOKS on Discord (`-#` subtext); this is how it is RECORDED, so Chat
// (/chat) can show it too.
//
// An ordinary ArchiveEntry MESSAGE with `source: "SYSTEM"` and no character:
//   - content carries NO `-#` — the web renders a SYSTEM row as
//     `.chat-subtext` itself (CHAT.md §5).
//   - the outbox never touches it (bot/src/lib/feedOutbox.js posts `WEB`
//     rows only), so it can't be echoed back into the poster's own channel.
//   - every poster writes the row BESIDE its Discord post, never instead.
//
// Best-effort like every other write in archive.js: swallows and logs.
// Takes `prisma` as a parameter, off the @lifeweb/db barrel (db/lib/dm.js
// convention); require it by path.

const { recordArchiveMessage } = require("./archive");
const {
  archiveContextForPlaceKey,
  placeKeyForLocation,
  placeKeyForRoom,
  placeKeyForZone,
} = require("./placeKey");

// `text` is the line; `lines` are quoted extras under it, taking the same `»`
// ambientLine gives them. `signed` is accepted for callers but does nothing.
async function sceneLine(prisma, { placeKey, text, lines = [], signed = true } = {}) {
  if (!placeKey) return null;

  const body = [
    String(text ?? "").trim(),
    ...lines.filter(Boolean).map((line) => `» ${line}`),
  ].filter(Boolean);
  if (body.length === 0) return null;

  void signed;
  const content = body.join("\n");

  try {
    const context = await archiveContextForPlaceKey(prisma, placeKey);
    return await recordArchiveMessage(prisma, {
      content,
      placeKey,
      source: "SYSTEM",
      zoneId: context.zoneId,
      zoneName: context.zoneName,
      threadName: context.threadName,
      // Not "location"/"summary": nobody typed this into a channel.
      channelKind: "scene",
    });
  } catch (err) {
    console.error("Scene line failed:", err.message ?? err);
    return null;
  }
}

// For a caller holding an id rather than a key. Exactly one of
// locationId/roomId/zoneId is used, in that order.
async function sceneLineAt(prisma, { locationId, roomId, zoneId, ...rest } = {}) {
  const placeKey =
    placeKeyForLocation(locationId) ?? placeKeyForRoom(roomId) ?? placeKeyForZone(zoneId);
  if (!placeKey) return null;
  return sceneLine(prisma, { placeKey, ...rest });
}

module.exports = { sceneLine, sceneLineAt };
