// "Play on Discord too" — the switch on the Bio card that puts a player's
// DISCORD ACCOUNT into the game, leaving the character exactly where it
// stands. Off by default (see docs/systemdocs/CHAT.md §6). The problem it
// solves is CHAT.md §1: a Location channel is opened with a per-member
// overwrite, so standing in the Keep tells everybody there which Discord
// account you are. Only ON grants that. OFF (the default) strips the
// Location overwrite, zone role, every narrowcast overwrite, every
// private-Room thread and Conversation thread.
// Survives either way: DMs, the OOC report channel, RoomGuest rows,
// PlayerThreadMember rows, and the fiction.
//
// THE TURN-PING ROLE GOES TOO — it's a <@&role> inside #turns, a channel
// this switch has just closed when turned off. It is NOT taken off here,
// deliberately: this function's only caller already writes it on the next
// line (web/app/(app)/character/actions.js), which has to handle the case
// this function never sees. The channel doctor's `turn-ping` reconcile
// backstops everybody else.
//
// THE ORDER MATTERS: the database flip lands FIRST, inside the cooldown
// guard, and every Discord call after it is best-effort — a failed REST call
// must never un-flip the switch, since the flag is what every
// re-materialiser reads.
//
// Takes `prisma` as its first parameter (the db/lib/dm.js convention) and is
// deliberately NOT on the @lifeweb/db barrel; require it by path.

const { revokeAllCharacterAccess } = require("./accessSweep");
const { removeThreadMember, setGuildNickname } = require("./discordRest");
const { materializeDiscordPresence } = require("./locationMove");
const { conversationsFor } = require("./conversations");
const { notifyPresence } = require("./presenceNotify");

// How long a character waits between two flips. Each flip is a burst of
// Discord writes, so the cooldown is hours, not seconds. The constant IS the setting.
const DISCORD_MIRROR_COOLDOWN_SECONDS = 7200;

// Every thread this account is in as a player: private Rooms their keys
// opened (Character.roomThreadRoomIds) and the Conversations they're in.
// Discord's own list is not read — the columns and rows ARE the record.
async function shedThreads(prisma, character) {
  const discordUserId = character.discordUserId;
  if (!discordUserId) return;

  const roomIds = character.roomThreadRoomIds ?? [];
  if (roomIds.length > 0) {
    const rooms = await prisma.room
      .findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true, discordThreadId: true } })
      .catch(() => []);
    for (const room of rooms) {
      if (!room.discordThreadId) continue;
      await removeThreadMember(room.discordThreadId, discordUserId).catch((err) =>
        console.error(`Discord mirror off: failed to drop ${character.id} from room "${room.name}":`, err.message ?? err),
      );
    }
    // Cleared whatever Discord answered — a stale id here would make every one of those rooms un-removable later.
    await prisma.character
      .update({ where: { id: character.id }, data: { roomThreadRoomIds: [] } })
      .catch((err) => console.error(`Discord mirror off: room record clear failed for ${character.id}:`, err.message ?? err));
  }

  // Conversations everywhere, not just where they stand — the account is leaving Discord altogether.
  const conversations = await conversationsFor(prisma, character.id).catch(() => []);
  for (const conversation of conversations) {
    await removeThreadMember(conversation.threadId, discordUserId).catch((err) =>
      console.error(
        `Discord mirror off: failed to drop ${character.id} from conversation ${conversation.threadId}:`,
        err.message ?? err,
      ),
    );
  }
}

// Flip the switch. Returns { ok: true } or { ok: false, error, readyAt } —
// `readyAt` is a Date, so the caller words the refusal in the reader's own
// clock rather than this one's.
async function setDiscordMirrored(prisma, character, on) {
  if (!character?.id) return { ok: false, error: "No character.", readyAt: null };
  const want = Boolean(on);

  const cooldownMs = DISCORD_MIRROR_COOLDOWN_SECONDS * 1000;

  const now = new Date();
  const cutoff = new Date(now.getTime() - cooldownMs);

  // The DB half first, as ONE conditional update, so two clicks in one tick
  // cannot both pass. `discordMirrored: !want` in the WHERE makes a repeat of the current state a no-op.
  const claimed = await prisma.character.updateMany({
    where: {
      id: character.id,
      discordMirrored: !want,
      OR: [{ discordMirroredChangedAt: null }, { discordMirroredChangedAt: { lte: cutoff } }],
    },
    data: { discordMirrored: want, discordMirroredChangedAt: now },
  });

  if (claimed.count === 0) {
    const row = await prisma.character.findUnique({
      where: { id: character.id },
      select: { discordMirrored: true, discordMirroredChangedAt: true },
    });
    // Already there: nothing to do and nothing to refuse.
    if (Boolean(row?.discordMirrored) === want) return { ok: true };
    const readyAt = new Date((row?.discordMirroredChangedAt?.getTime() ?? now.getTime()) + cooldownMs);
    const minutes = Math.max(1, Math.round((now.getTime() - (row?.discordMirroredChangedAt?.getTime() ?? 0)) / 60000));
    // Built here so a caller with no clock of its own has one; the web re-words it in the reader's locale.
    const clock = readyAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return {
      ok: false,
      error: `You switched ${minutes} minutes ago. You can switch again at ${clock}.`,
      minutes,
      readyAt,
    };
  }

  // Everything below is Discord, every call wrapped — a failure leaves the flag as the player set it, doctor repairs the rest.
  const row = await prisma.character
    .findUnique({
      where: { id: character.id },
      select: {
        id: true,
        name: true,
        status: true,
        discordUserId: true,
        discordRoleId: true,
        locationId: true,
        zoneId: true,
        discordMirrored: true,
        roomThreadRoomIds: true,
      },
    })
    .catch(() => null);

  if (row?.discordUserId && process.env.DISCORD_TOKEN) {
    try {
      if (want) {
        await materializeDiscordPresence(prisma, row);
      } else {
        // keepGuests: a RoomGuest row is game state, not Discord state — the web feed still reads it to show them the room.
        await revokeAllCharacterAccess(prisma, row, { keepGuests: true });
        // The nickname is the loudest leak of all — cleared, not merely no longer synced (bot/src/lib/nickname.js skips them from now on).
        await setGuildNickname(row.discordUserId, null).catch((err) =>
          console.error(`discord mirror: couldn't clear the nickname for ${row.discordUserId}:`, err.message ?? err),
        );
        await shedThreads(prisma, row);
      }
    } catch (err) {
      console.error(`Discord mirror ${want ? "on" : "off"} for ${row.name ?? row.id} left work undone:`, err.message ?? err);
    }
  }

  // The flag is about Discord, not what /chat may read, but the places chip isn't — an open tab shouldn't need a reload to lose it.
  await notifyPresence(prisma, character.id).catch(() => {});

  return { ok: true };
}

module.exports = { setDiscordMirrored, DISCORD_MIRROR_COOLDOWN_SECONDS };
