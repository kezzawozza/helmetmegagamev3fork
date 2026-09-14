// Private-room membership: members are exactly the characters ENTITLED — a
// Room.accessTagSlugs tag, or a RoomGuest row. Recomputed from tags, never
// pushed from inside a tag writer. MEMBERSHIP DOES NOT FOLLOW THE FEET —
// Discord already gates a thread on VIEW_CHANNEL of its parent Location
// channel (CLAUDE.md "Discord permission model"). GUESTS ARE still
// presence-based deliberately: /add writes a RoomGuest row, swept here. Takes
// `prisma` as a parameter and stays off the @lifeweb/db barrel; require it by path.
const { addThreadMember, removeThreadMember } = require("./discordRest");
const { notifyPresence } = require("./presenceNotify");

// Rooms this character may enter. `guestRoomIds` defaults empty for a keys-only caller, but
// anything deciding what a PERSON can reach must pass it. `allowedRoomIds` is Quests' door (docs/systemdocs/QUESTS.md).
function accessibleRooms(rooms, heldSlugs, guestRoomIds = new Set(), allowedRoomIds = new Set()) {
  return rooms.filter(
    (room) =>
      room.kind !== "PRIVATE" ||
      guestRoomIds.has(room.id) ||
      allowedRoomIds.has(room.id) ||
      room.accessTagSlugs.some((slug) => heldSlugs.has(slug)),
  );
}

async function questAllowedRoomIds(prisma, characterId) {
  const rows = await prisma.quest
    .findMany({
      where: { status: "OPEN", allowedCharacterIds: { has: characterId } },
      select: { room: { select: { id: true } } },
    })
    .catch(() => []);
  return new Set(rows.map((q) => q.room?.id).filter(Boolean));
}

async function heldTagSlugs(prisma, characterId) {
  const tags = await prisma.characterTag.findMany({
    where: { characterId },
    select: { tag: { select: { slug: true } } },
  });
  return new Set(tags.map((t) => t.tag.slug));
}

async function guestRoomIds(prisma, characterId) {
  const rows = await prisma.roomGuest.findMany({
    where: { characterId },
    select: { roomId: true },
  });
  return new Set(rows.map((r) => r.roomId));
}

async function roomAccessKeys(prisma, characterId) {
  const [heldSlugs, guests, allowed] = await Promise.all([
    heldTagSlugs(prisma, characterId),
    guestRoomIds(prisma, characterId),
    questAllowedRoomIds(prisma, characterId),
  ]);
  return { heldSlugs, guestRoomIds: guests, allowedRoomIds: allowed };
}

// Returns { added, removed }. THERE IS NO CHEAP MODE, deliberately — a `guestsOnly` fast
// path narrowed the scope so a move could never repair drift the diff would otherwise catch.
async function syncCharacterRoomAccess(prisma, character, { tagSlugs = null } = {}) {
  const result = { added: 0, removed: 0 };
  if (!character?.id) return result;

  const rooms = await prisma.room.findMany({
    where: { kind: "PRIVATE", discordThreadId: { not: null } },
    select: { id: true, name: true, locationId: true, kind: true, accessTagSlugs: true, questId: true, discordThreadId: true },
  });

  // Spend stale guest grants before the recompute below and before the
  // DISCORD_TOKEN bail-out. The mover has its own token guard, so a tokenless
  // move never reaches this line; the doctor's room-guest check is the backstop.
  const alive = character.status === "ALIVE";
  const staleGuestWhere = {
    characterId: character.id,
    ...(alive && character.locationId ? { room: { locationId: { not: character.locationId } } } : {}),
  };
  await prisma.roomGuest
    .deleteMany({ where: staleGuestWhere })
    .catch((err) => console.error(`Room guest sweep failed for ${character.id}:`, err.message ?? err));

  if (rooms.length === 0) return result;
  if (!process.env.DISCORD_TOKEN) return result;
  // A character with no account cannot be a thread member; the guest sweep above still ran for them.
  if (!character.discordUserId) return result;

  // Entitlement, deliberately NOT filtered by location: holding the key is the whole test.
  const held = alive ? tagSlugs ?? (await heldTagSlugs(prisma, character.id)) : new Set();
  const guests = alive ? await guestRoomIds(prisma, character.id) : new Set();
  const allowed = alive ? await questAllowedRoomIds(prisma, character.id) : new Set();
  const entitled = alive
    ? new Set(accessibleRooms(rooms, held, guests, allowed).map((r) => r.id))
    : new Set();

  // What Discord has been told, so we act on the DIFFERENCE: entitlement is recomputed
  // constantly (every equip, every meal) and almost never changes, so this makes no calls at all.
  const record = await prisma.character
    .findUnique({ where: { id: character.id }, select: { roomThreadRoomIds: true, webOnly: true } })
    .catch(() => null);
  const stored = new Set(record?.roomThreadRoomIds ?? []);

  // "web only" (docs/systemdocs/CHAT.md §6): cleared rather than never computed, so the diff below REMOVES whatever they still stand in.
  if (record?.webOnly) entitled.clear();

  const targets = rooms.filter((room) => entitled.has(room.id) !== stored.has(room.id));
  if (targets.length === 0) return result;

  // Wake their tabs before the Discord calls, the slow part (docs CHAT.md §3).
  await notifyPresence(prisma, character.id);

  const next = new Set(stored);
  for (const room of targets) {
    try {
      if (entitled.has(room.id)) {
        await addThreadMember(room.discordThreadId, character.discordUserId);
        next.add(room.id);
        result.added += 1;
      } else {
        await removeThreadMember(room.discordThreadId, character.discordUserId);
        next.delete(room.id);
        result.removed += 1;
      }
    } catch (err) {
      // Left OUT of `next` on failure, so the next run retries rather than recording a membership Discord never accepted.
      console.error(`Room access sync failed for ${character.id} in "${room.name}":`, err.message ?? err);
    }
  }

  await prisma.character
    .update({ where: { id: character.id }, data: { roomThreadRoomIds: [...next] } })
    .catch((err) => console.error(`Room membership record failed for ${character.id}:`, err.message ?? err));
  return result;
}

// Record/unrecord one room for code paths that push membership WITHOUT the
// recompute above: /add, /remove, the doctor's repair. They must call this or
// the column lies — an ACCESS CONTROL FAILURE in the quiet direction, since
// the diff only acts where `entitled` and `stored` DISAGREE, so a membership
// Discord has but the column does not is a membership that can never be removed.
async function recordRoomThread(prisma, characterId, roomId, present) {
  if (!characterId || !roomId) return;
  const row = await prisma.character
    .findUnique({ where: { id: characterId }, select: { roomThreadRoomIds: true } })
    .catch(() => null);
  if (!row) return;
  const current = row.roomThreadRoomIds ?? [];
  if (current.includes(roomId) === Boolean(present)) return; // already right
  const next = present ? [...current, roomId] : current.filter((id) => id !== roomId);
  await prisma.character
    .update({ where: { id: characterId }, data: { roomThreadRoomIds: next } })
    .catch((err) => console.error(`Room membership record failed for ${characterId}:`, err.message ?? err));
}

module.exports = {
  recordRoomThread,
  syncCharacterRoomAccess,
  accessibleRooms,
  heldTagSlugs,
  guestRoomIds,
  questAllowedRoomIds,
  roomAccessKeys,
};
