// Talking through a modular gate (docs/zones.yaml `modular:`) — a line said in a PUBLIC Room at one
// end echoes into every PUBLIC Room at the other, open or shut. Private Rooms, Conversations and a
// soundproof Room never echo. The echo is an ordinary WEB row on the far Room's place key;
// bot/src/lib/feedOutbox.js posts every unsynced WEB row as the character, so no Discord code here.
// Written through recordArchiveMessage, never recordSpeech, so an echo can never echo again.
// Takes `prisma`, off the @lifeweb/db barrel (db/lib/dm.js convention).

const { recordArchiveMessage } = require("./archive");
const { TOKEN_RE } = require("./characterMentions");
const { endpoints, linksFor } = require("./locationGraph");
const { archiveContextForPlaceKey, parsePlaceKey, placeKeyForRoom } = require("./placeKey");

const EARSHOT = { kind: "PUBLIC", soundproof: false };

// The Locations across a modular gate from this one.
async function gateNeighbours(prisma, locationId) {
  const links = await linksFor(prisma, locationId);
  return links.filter((link) => link.modular).map((link) => endpoints(link, locationId).far).filter(Boolean);
}

// The Rooms a line said at `placeKey` carries into. Empty for anything but a public, non-soundproof
// Room at one end of a modular gate.
async function echoRoomsFor(prisma, placeKey) {
  const parsed = parsePlaceKey(placeKey);
  if (parsed?.kind !== "room") return [];

  const room = await prisma.room.findUnique({
    where: { id: parsed.id },
    select: { kind: true, soundproof: true, locationId: true },
  });
  if (!room || room.kind !== EARSHOT.kind || room.soundproof) return [];

  const far = await gateNeighbours(prisma, room.locationId);
  if (far.length === 0) return [];

  return prisma.room.findMany({
    where: { locationId: { in: far.map((loc) => loc.id) }, ...EARSHOT },
    select: { id: true, name: true, locationId: true },
    orderBy: [{ locationId: "asc" }, { sortOrder: "asc" }],
  });
}

// `{char:<id>|Name}` becomes plain `Name` so the outbox doesn't relay a second mention DM. `-# ` per line.
function echoContent(content) {
  const plain = String(content ?? "").replace(TOKEN_RE, (_match, _id, name) => name || "someone");
  return plain
    .split("\n")
    .map((line) => `-# ${line}`)
    .join("\n");
}

// `row` is the ArchiveEntry recordSpeech just wrote. Best-effort — an echo is never worth failing the line.
async function echoSpeech(prisma, prepared, row) {
  if (!row?.placeKey || !prepared?.character?.id) return [];
  const rooms = await echoRoomsFor(prisma, row.placeKey);
  const written = [];
  for (const room of rooms) {
    const placeKey = placeKeyForRoom(room.id);
    try {
      const context = await archiveContextForPlaceKey(prisma, placeKey);
      const echo = await recordArchiveMessage(prisma, {
        content: echoContent(row.content),
        character: prepared.character,
        concealedAlias: row.concealedAlias ?? null,
        presentedAvatarPath: row.presentedAvatarPath ?? null,
        presentedState: prepared.presentedState ?? null,
        placeKey,
        source: "WEB",
        zoneId: context.zoneId,
        zoneName: context.zoneName,
        channelKind: context.channelKind,
        threadName: context.threadName,
      });
      if (echo) written.push(echo);
    } catch (err) {
      console.error(`Gate echo into ${room.name} failed:`, err.message ?? err);
    }
  }
  return written;
}

module.exports = { echoRoomsFor, echoContent, echoSpeech, gateNeighbours };
