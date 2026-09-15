// A RoomGuest row is the ONE way into a private room's thread without one of its access tags (db/lib/roomAccess.js). Both faces call these —
// the bot picks its target from a Discord ROLE and hands the id down. Who may work the door: anyone STANDING here who can get in — a key or a
// guest row, plus their own feet — or a GM. The target has to be standing here too, since the grant is spent the moment they leave. removeRoomGuest
// refuses a key-holder on purpose: their key would let them straight back in, so taking the key is the real removal.

const { heldTagSlugs, recordRoomThread, roomAccessKeys } = require("./roomAccess");
const { addThreadMember, removeThreadMember } = require("./discordRest");
const { presentedMembers, presentedNameOf } = require("./presentedMembers");

const ROOM_SELECT = {
  id: true,
  name: true,
  kind: true,
  accessTagSlugs: true,
  locationId: true,
  discordThreadId: true,
  location: { select: { name: true } },
};

const GUEST_SELECT = {
  id: true,
  name: true,
  status: true,
  locationId: true,
  discordUserId: true,
  discordMirrored: true,
  updatedAt: true,
};

// The shared front half: the room, the actor's standing, and the target.
// `actor` may be null for a GM. Returns { room, target } or { error }.
async function doorwayFor(prisma, { actor, roomId, characterId, gm = false }) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: ROOM_SELECT });
  if (!room) return { error: "That room no longer exists." };
  if (room.kind !== "PRIVATE") return { error: "Anyone standing here can already walk in." };

  if (!gm) {
    if (!actor?.id || !room.locationId || actor.locationId !== room.locationId) {
      return { error: "You're not in this room." };
    }
    // Standing at the Location is NOT being inside the room. A key or a guest row is what being inside means, the same pair accessibleRooms() tests.
    const keys = await roomAccessKeys(prisma, actor.id);
    const inside =
      room.accessTagSlugs.some((slug) => keys.heldSlugs.has(slug)) || keys.guestRoomIds.has(room.id);
    if (!inside) return { error: "You aren't inside that room." };
  }

  const target = await prisma.character.findFirst({
    where: { id: String(characterId ?? ""), status: "ALIVE" },
    select: GUEST_SELECT,
  });
  if (!target) return { error: "That isn't a living character." };
  if (target.locationId !== room.locationId) {
    return { error: `${await presentedNameOf(prisma, target.id, actor)} isn't here to be let in.` };
  }
  return { room, target };
}

// `notify` is the "a door opened for you" DM the caller sends, left to the caller since the two faces reach a player's DMs differently.
async function addRoomGuest(prisma, { actor = null, roomId, characterId, gm = false } = {}) {
  const found = await doorwayFor(prisma, { actor, roomId, characterId, gm });
  if (found.error) return { ok: false, error: found.error };
  const { room, target } = found;

  await prisma.roomGuest
    .upsert({
      where: { roomId_characterId: { roomId: room.id, characterId: target.id } },
      update: {},
      create: { roomId: room.id, characterId: target.id, invitedById: actor?.id ?? null },
    })
    .catch((err) => console.error("Failed to record room guest:", err.message ?? err));

  // The guest ROW above is the grant; thread membership is only Discord's copy — a character not mirrored to Discord has none (CHAT.md §6).
  if (target.discordMirrored && target.discordUserId && room.discordThreadId) {
    try {
      await addThreadMember(room.discordThreadId, target.discordUserId);
      // Without this the guest is never shown out: the mover's recompute only acts where entitlement and the record DISAGREE.
      await recordRoomThread(prisma, target.id, room.id, true);
    } catch (err) {
      console.error(`Failed to add ${target.discordUserId} to room ${room.id}:`, err.message ?? err);
    }
  }

  return {
    ok: true,
    room,
    target,
    notify: {
      discordUserId: target.discordUserId,
      placeName: room.location?.name ?? null,
      threadName: room.name,
      threadId: room.discordThreadId,
    },
    line: `${await presentedNameOf(prisma, target.id, actor)} was let in.`,
  };
}

async function removeRoomGuest(prisma, { actor = null, roomId, characterId, gm = false } = {}) {
  const found = await doorwayFor(prisma, { actor, roomId, characterId, gm });
  if (found.error) return { ok: false, error: found.error };
  const { room, target } = found;

  const held = await heldTagSlugs(prisma, target.id);
  if (room.accessTagSlugs.some((slug) => held.has(slug))) {
    return { ok: false, error: "You can't remove them; they have a key." };
  }

  await prisma.roomGuest
    .deleteMany({ where: { roomId: room.id, characterId: target.id } })
    .catch((err) => console.error("Failed to delete room guest:", err.message ?? err));

  if (target.discordUserId && room.discordThreadId) {
    try {
      await removeThreadMember(room.discordThreadId, target.discordUserId);
      // The record has to follow, or syncCharacterRoomAccess sees no disagreement and this eviction un-does itself on the next sync.
      await recordRoomThread(prisma, target.id, room.id, false);
    } catch (err) {
      console.error(`Failed to remove ${target.discordUserId} from room ${room.id}:`, err.message ?? err);
      return { ok: false, error: "Couldn't remove them. The bot may be missing Manage Threads." };
    }
  }

  const shown = await presentedNameOf(prisma, target.id, actor ?? null);
  return { ok: true, room, target, line: `${shown} was shown out.` };
}

// Who is in a private room on a guest row. Key-holders are NOT in this list — a different fact the room's own accessTagSlugs already says.
// Through db/lib/presentedMembers.js, the same resolver the HERE column and a conversation's strip go through — /api/avatar/<id> is ungated, so
// a raw id would leak a hooded guest's real portrait.
async function roomGuests(prisma, roomId, viewer, options) {
  if (!roomId) return [];
  const rows = await prisma.roomGuest.findMany({
    where: { roomId },
    orderBy: { createdAt: "asc" },
    select: { characterId: true },
  });
  if (rows.length === 0) return [];
  return presentedMembers(prisma, rows.map((row) => row.characterId), viewer, options);
}

module.exports = { addRoomGuest, removeRoomGuest, roomGuests };
