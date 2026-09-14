// The channel doctor's full-scope thread bookkeeping sweep — room threads,
// private-room membership, PlayerThread rows, room guests, and thread
// invites. Moved verbatim out of runChannelDoctor (W2d).
const { getChannel, patchThread, listThreadMembers, addThreadMember, removeThreadMember } = require("../../discordRest");
const { accessibleRooms, roomAccessKeys, recordRoomThread } = require("../../roomAccess");

async function runThreadsSweep({ report, errors, prisma, alive, characters, characterUserIds }) {
  // Room threads: exist and are unarchived. Recreating one is the sync's
  // job (it needs the YAML body), so a missing thread is report-only.
  const rooms = await prisma.room.findMany({ include: { location: { select: { name: true } } } });
  const privateRooms = [];
  for (const room of rooms) {
    const label = `${room.location.name}/${room.name}`;
    if (!room.discordThreadId) {
      await report("room-thread", label, "room has no thread recorded (run db:sync-zones)");
      continue;
    }
    let live;
    try {
      live = await getChannel(room.discordThreadId, { allow404: true });
    } catch (err) {
      errors.push({ check: "room-thread", target: label, message: err.message });
      continue;
    }
    if (!live) {
      await report("room-thread", label, "recorded room thread no longer exists (run db:sync-zones)");
      continue;
    }
    if (live.thread_metadata?.archived) {
      await report("room-thread", label, "room thread is archived", () =>
        patchThread(room.discordThreadId, { archived: false }),
      );
    }
    if (room.kind === "PRIVATE") privateRooms.push({ ...room, label });
  }

  // Private-room membership: exactly the living characters ENTITLED to the
  // room — holding one of its access tags, or let in by hand (RoomGuest).
  // NOT filtered by where they are standing: membership stopped following
  // presence on 2026-09-06 (db/lib/roomAccess.js), because a thread is gated
  // on VIEW_CHANNEL of its parent anyway and the add/remove was only earning
  // an undeletable "added <name> to the thread" line on every arrival.
  //
  // This check is therefore also the BACKFILL: run the doctor once after that
  // change and every keyholder lands in every thread they are entitled to,
  // which is what "do it all at game start" means in practice.
  // Thread-major: one member-list read per private room.
  //
  // Guests are NOT optional here. This check deletes anyone it can't account
  // for, so a doctor that only knew about keys would evict every guest the
  // next time anyone ran it. Full scope only — the bot's ready pass is
  // `cheap` and never reaches this line — but "only on demand" is not
  // "never".
  if (privateRooms.length > 0) {
    // recordRoomThread keys on the CHARACTER, and everything down here is
    // keyed on the Discord user, so the two need bridging once.
    const userIdToCharacterId = new Map(
      alive.filter((c) => c.discordUserId).map((c) => [c.discordUserId, c.id]),
    );
    const keysByCharacter = new Map();
    for (const c of alive) keysByCharacter.set(c.id, await roomAccessKeys(prisma, c.id));
    for (const room of privateRooms) {
      const shouldHave = new Set(
        alive
          .filter((c) => c.discordUserId && !c.webOnly)
          .filter((c) => {
            const keys = keysByCharacter.get(c.id);
            return accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length > 0;
          })
          .map((c) => c.discordUserId),
      );
      let live;
      try {
        live = await listThreadMembers(room.discordThreadId);
      } catch (err) {
        errors.push({ check: "room-membership", target: room.label, message: err.message });
        continue;
      }
      const present = new Set(live.map((m) => m.user_id));
      for (const userId of shouldHave) {
        if (present.has(userId)) continue;
        // The record follows the repair. Without it the doctor's own backfill
        // would poison every later key revocation: syncCharacterRoomAccess
        // acts only where entitlement and the record disagree, so a
        // membership the doctor added but never recorded can never be taken
        // away again. See db/lib/roomAccess.js#recordRoomThread.
        await report("room-membership", `${room.label}/${userId}`, "holds a key and isn't in the room", async () => {
          await addThreadMember(room.discordThreadId, userId);
          await recordRoomThread(prisma, userIdToCharacterId.get(userId), room.id, true);
        });
      }
      for (const userId of present) {
        if (shouldHave.has(userId)) continue;
        if (!characterUserIds.has(userId)) continue; // GMs and the bot may sit in any thread
        await report("room-membership", `${room.label}/${userId}`, "in the room without a key", async () => {
          await removeThreadMember(room.discordThreadId, userId);
          await recordRoomThread(prisma, userIdToCharacterId.get(userId), room.id, false);
        });
      }
    }
  }

  // PlayerThread bookkeeping.
  const rows = await prisma.playerThread.findMany();
  for (const row of rows) {
    const live = await getChannel(row.threadId, { allow404: true }).catch(() => undefined);
    if (live === null) {
      await report("player-thread", row.name, "tracked thread no longer exists on Discord", async () => {
        await prisma.playerThread.deleteMany({ where: { threadId: row.threadId } });
        await prisma.playerThreadInvite.deleteMany({ where: { threadId: row.threadId } });
      });
    }
  }

  // Room guests who no longer qualify: dead, or wandered off. The membership
  // check above repairs the THREAD; this repairs the row behind it, so a
  // guest who left doesn't sit in the table until they happen to move again.
  const guests = await prisma.roomGuest.findMany({
    include: { room: { select: { locationId: true, name: true } } },
  });
  for (const guest of guests) {
    const character = characters.find((c) => c.id === guest.characterId);
    const stillHere =
      character?.status === "ALIVE" && guest.room && character.locationId === guest.room.locationId;
    if (stillHere) continue;
    await report(
      "room-guest",
      `${guest.room?.name ?? guest.roomId}/${guest.characterId}`,
      "guest is dead or no longer standing in the room's location",
      () =>
        prisma.roomGuest.delete({
          where: { roomId_characterId: { roomId: guest.roomId, characterId: guest.characterId } },
        }),
    );
  }

  // Dead invites: character gone, or thread untracked.
  const invites = await prisma.playerThreadInvite.findMany();
  const trackedThreadIds = new Set(rows.map((r) => r.threadId));
  const characterIds = new Set(characters.filter((c) => c.status === "ALIVE").map((c) => c.id));
  for (const invite of invites) {
    if (trackedThreadIds.has(invite.threadId) && characterIds.has(invite.characterId)) continue;
    await report(
      "thread-invite",
      `${invite.threadId}/${invite.characterId}`,
      "invite for a dead character or untracked thread",
      () =>
        prisma.playerThreadInvite.delete({
          where: { threadId_characterId: { threadId: invite.threadId, characterId: invite.characterId } },
        }),
    );
  }
}

module.exports = { runThreadsSweep };
