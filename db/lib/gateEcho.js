// Talking through a gate.
//
// A modular gate (docs/zones.yaml `modular:`) is a portcullis, and people on
// either side of one can see and hear each other through the bars. So a line
// said in a PUBLIC Room at one end is echoed into every PUBLIC Room at the
// other end, open or shut. Private Rooms and Conversations are behind a door
// and never echo either way; nor does a soundproof Room.
//
// The echo is an ordinary WEB row on the far Room's place key, carrying the
// speaker's character and frozen identity columns. bot/src/lib/feedOutbox.js
// posts every unsynced WEB row as the character, so the far side gets a full
// proxied message on Discord and the same row on /chat — no Discord code here.
// Every line is `-#` so it reads as coming from further off.
//
// Written through recordArchiveMessage, never recordSpeech, so an echo can
// never echo again. Editing or deleting the original does not follow it.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.

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

// The Rooms a line said at `placeKey` carries into. Empty for anything but a
// public, non-soundproof Room at one end of a modular gate.
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

// `{char:<id>|Name}` becomes plain `Name`, so the outbox does not relay a
// second mention DM for the echo. Then `-# ` on every line, because Discord
// reads the prefix per line.
function echoContent(content) {
  const plain = String(content ?? "").replace(TOKEN_RE, (_match, _id, name) => name || "someone");
  return plain
    .split("\n")
    .map((line) => `-# ${line}`)
    .join("\n");
}

// `row` is the ArchiveEntry recordSpeech just wrote. Best-effort throughout:
// an echo is never worth failing the line it rode in on.
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
