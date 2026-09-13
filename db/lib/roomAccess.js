// Private-room membership: a private Room is a private thread whose members are
// exactly the characters ENTITLED to it — holding one of Room.accessTagSlugs,
// or carrying a RoomGuest row for it. A key gained opens the door, a key lost
// closes it. Recomputed from tags, never pushed from inside a tag writer.
//
// MEMBERSHIP DOES NOT FOLLOW THE FEET, and that is the whole point of this
// file's 2026-09-06 rewrite. It used to: you were added on arrival and removed
// on departure, which meant Discord narrated "… added <name> to the thread"
// into the room mid-scene on every single visit, forever. That notice is a
// RecipientAdd system message and Discord REFUSES to delete it — the attempt
// in bot/src/events/messageCreate.js is still there and still fails — so the
// only lever was to stop generating it.
//
// Dropping the presence half costs nothing, because presence is already
// enforced one layer down: Discord gates a thread on VIEW_CHANNEL of its
// PARENT, and a character only holds the per-member overwrite on the one
// Location channel they are standing in (db/lib/locationMove.js, and CLAUDE.md
// "Discord permission model"). A keyholder standing elsewhere is a member of a
// thread they cannot see, and it comes back when they walk in. The add/remove
// was buying a rule the channel already enforced, and paying for it in spam.
//
// So a MOVE now issues no thread calls at all. A full recompute runs only when
// entitlement can actually have changed: creation, a tag grant or loss, death,
// and the doctor's backstop.
//
// Plus GUESTS, which ARE still presence-based — deliberately, because a guest
// is somebody let in by hand rather than by key, and the door shutting behind
// them is the point. /add in a private Room writes a RoomGuest row; the row is
// spent when they leave, and this file deletes every guest row whose Room is
// not where the character now stands. Every mover calls in here with the
// destination, which is what that sweep needs and the only reason a move still
// calls in at all.
//
// Pure REST (thread-member calls have no gateway-only form), so both faces
// and the staged push call this one function. Takes `prisma` as a parameter
// — the db/lib/dm.js convention — and is deliberately not on the @lifeweb/db
// barrel; require it by path.
const { addThreadMember, removeThreadMember } = require("./discordRest");
const { notifyPresence } = require("./presenceNotify");

// The rooms in `locationId` this character may enter. Shared with the channel
// doctor, the Secret rooms? button, the Storage button, the Transfer dialog,
// corpse placement and equipment reach, so all of them agree about one door.
//
// `guestRoomIds` defaults empty: a caller that genuinely only cares about keys
// (the sync, which has no character in hand) can leave it off, but anything
// deciding what a PERSON can reach must pass it, or a guest sees the thread
// and is then told the stash isn't theirs.
// `allowedRoomIds` is the fourth door, and it belongs to Quests
// (docs/systemdocs/QUESTS.md): a GM naming specific characters on a quest,
// rather than a key or a hand-written invitation. It could not reuse
// guestRoomIds, because a guest grant is spent the moment its holder walks off
// the Location and a quest's allowlist has to outlast that.
//
// It defaults empty, so a caller that has no character in hand — or one that
// predates quests — asks exactly the question it always asked.
function accessibleRooms(rooms, heldSlugs, guestRoomIds = new Set(), allowedRoomIds = new Set()) {
  return rooms.filter(
    (room) =>
      room.kind !== "PRIVATE" ||
      guestRoomIds.has(room.id) ||
      allowedRoomIds.has(room.id) ||
      room.accessTagSlugs.some((slug) => heldSlugs.has(slug)),
  );
}

// The rooms an OPEN quest names this character on by hand.
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

// The rooms this character has been let into by hand.
async function guestRoomIds(prisma, characterId) {
  const rows = await prisma.roomGuest.findMany({
    where: { characterId },
    select: { roomId: true },
  });
  return new Set(rows.map((r) => r.roomId));
}

// Both halves of the door in one round trip. Every caller that asks "what can
// this character reach" wants both, and loading them separately is how the two
// answers drift apart.
async function roomAccessKeys(prisma, characterId) {
  const [heldSlugs, guests, allowed] = await Promise.all([
    heldTagSlugs(prisma, characterId),
    guestRoomIds(prisma, characterId),
    questAllowedRoomIds(prisma, characterId),
  ]);
  return { heldSlugs, guestRoomIds: guests, allowedRoomIds: allowed };
}

// `character` needs { id, discordUserId, locationId, status }; `tagSlugs` may
// be passed by a caller that already holds them. Returns { added, removed }.
// Every private room in the game gets at most one idempotent call. A miss is
// logged and left for the doctor.
//
// THERE IS NO CHEAP MODE, and there deliberately isn't one. The diff below
// already makes a move cost zero Discord calls — entitlement did not change, so
// the delta is empty — and every narrowing option tried here has been a bug:
// `locationOnly` missed a key gained for a room in another zone, and a
// `guestsOnly` fast path narrowed the scope so a move could never repair drift
// the diff would otherwise catch. One path, always the full recompute.
async function syncCharacterRoomAccess(prisma, character, { tagSlugs = null } = {}) {
  const result = { added: 0, removed: 0 };
  if (!character?.id) return result;

  const rooms = await prisma.room.findMany({
    where: { kind: "PRIVATE", discordThreadId: { not: null } },
    select: { id: true, name: true, locationId: true, kind: true, accessTagSlugs: true, questId: true, discordThreadId: true },
  });

  // Spend every guest grant that is no longer where the character is standing.
  // Before the membership recompute below, so the recompute reads the rows this
  // just settled, and before the DISCORD_TOKEN bail-out, so a caller that got
  // this far still gets the row right even when it cannot reach Discord.
  //
  // That is not a promise the whole game keeps, though: the mover
  // (locationMove.js#applyLocationMoveSideEffects) has its OWN token guard
  // ahead of its call into here, so a tokenless move never reaches this line.
  // Nothing else about such a move works either — no overwrite swap, no role
  // swap — and the doctor's room-guest check is the backstop.
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
  // Below this line is Discord work, and a character with no account cannot be
  // a thread member. The guest sweep above still had to run for them: /add
  // writes a RoomGuest row whatever the id, and a row nothing ever spends
  // grants that room forever to every accessibleRooms() reader.
  if (!character.discordUserId) return result;

  // Entitlement, and deliberately NOT filtered by where they are standing:
  // holding the key is the whole test. A dead character is entitled to nothing,
  // which is what removes them everywhere.
  const held = alive ? tagSlugs ?? (await heldTagSlugs(prisma, character.id)) : new Set();
  const guests = alive ? await guestRoomIds(prisma, character.id) : new Set();
  const allowed = alive ? await questAllowedRoomIds(prisma, character.id) : new Set();
  const entitled = alive
    ? new Set(accessibleRooms(rooms, held, guests, allowed).map((r) => r.id))
    : new Set();

  // What Discord has actually been told, so we can act on the DIFFERENCE. This
  // is the whole reason the tag-change path is affordable: entitlement is
  // recomputed constantly (every equip, every meal) and almost never changes,
  // so the delta is almost always empty and this makes no calls at all.
  const record = await prisma.character
    .findUnique({ where: { id: character.id }, select: { roomThreadRoomIds: true, webOnly: true } })
    .catch(() => null);
  const stored = new Set(record?.roomThreadRoomIds ?? []);

  // The "web only" switch (docs/systemdocs/CHAT.md §6) holds this account out
  // of every channel, so it is entitled to no thread at all until it comes
  // back off. Cleared rather than never computed, on purpose: the diff below
  // then REMOVES whatever they still stand in. Read here rather than off the
  // passed-in `character`, because a dozen callers hand this function a row
  // with their own select and only one of them would have thought to ask.
  // Feed access is untouched — placesFor reads accessibleRooms directly.
  if (record?.webOnly) entitled.clear();

  const targets = rooms.filter((room) => entitled.has(room.id) !== stored.has(room.id));
  if (targets.length === 0) return result;

  // A door opened or shut, so this character's /chat place list changed —
  // wake their tabs before the Discord calls, which are the slow part and can
  // fail without changing the answer the web gives (docs CHAT.md §3).
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
      // Left OUT of `next` on failure, so the next run retries it rather than
      // recording a membership Discord never accepted. The doctor is the
      // backstop either way.
      console.error(`Room access sync failed for ${character.id} in "${room.name}":`, err.message ?? err);
    }
  }

  await prisma.character
    .update({ where: { id: character.id }, data: { roomThreadRoomIds: [...next] } })
    .catch((err) => console.error(`Room membership record failed for ${character.id}:`, err.message ?? err));
  return result;
}

// Record — or unrecord — one room in Character.roomThreadRoomIds, for the code
// paths that push a thread membership WITHOUT going through the recompute
// above: /add and /remove (bot/src/events/interactionCreate.js) and the
// channel doctor's room-membership repair.
//
// They must call this or the column lies, and a lying column is not a wasted
// call, it is an ACCESS CONTROL FAILURE in the quiet direction: the diff at
// the heart of syncCharacterRoomAccess only acts where `entitled` and `stored`
// DISAGREE, so a membership Discord has but the column does not is a
// membership that can never be removed. A guest let in by /add would keep the
// room forever, and after a doctor backfill every key revocation in the game
// would silently stop evicting.
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
