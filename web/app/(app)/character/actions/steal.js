// Steal (docs/systemdocs/THEFT.md §1): taking something out of a room stash
// you can reach, quietly.
//
// This is Transfer's room -> you path with the room line suppressed, and it
// stays that way on purpose. Reach, the tradeable filter, the non-stackable
// clamp, the carry ceiling, the per-line TRANSFER_TAG rows a GM undoes from
// /gm/turns, and the afterInventoryChange tail are all already written once in
// transferRequestImpl. Forking that function to add a die to it is the thing
// this file exists to avoid.
//
// The goods ALWAYS move. The die decides one thing: whether the room is told.

import { after } from "next/server";
import { prisma, placeKeyForRoom } from "@lifeweb/db";
import { rollWithAdvantage } from "@lifeweb/db/lib/advantage";
import { stealModifiers, stealSucceeds, stealTotal } from "@lifeweb/db/lib/steal";
import { announceInRoom } from "@lifeweb/db/lib/roomAnnounce";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { UserError } from "@/lib/actionResult";
import { ACT } from "@lifeweb/db/lib/incapacitation";
import { requireCharacter } from "./shared.js";
import { transferRequestImpl } from "./transfer.js";

// Bascinet's words, verbatim.
const CAUGHT_LINE = "tried to steal an item.";

export async function stealRequestImpl({ fromKey, tags }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // The SOURCE is the only end the client gets to name, and it must be a room.
  // The destination is never posted at all — it is the session's own character,
  // resolved below, so there is no verb here for stealing into somebody else's
  // pocket or straight into a cupboard.
  const raw = String(fromKey ?? "");
  if (!raw.startsWith("room:")) throw new UserError("You can only steal from a stash.");

  // Everything that can refuse this runs FIRST, inside transferRequestImpl —
  // reach, the tradeable filter, the clamp, the ceiling. Rolling after it means
  // a refusal costs no die and, more to the point, that nothing ever announces
  // a theft that did not happen.
  await transferRequestImpl(
    { fromKey: raw, toKey: `character:${character.id}`, tags, amount: 0 },
    { announceTake: false },
  );

  // Every d6 a character throws goes through rollWithAdvantage, so Lucky
  // applies here — quietly and permanently, the same admission SEARCH.md §3b
  // makes about a die nobody is shown.
  const roll = rollWithAdvantage(character.tags, 6);
  const modifiers = stealModifiers(character.tags);
  const unseen = stealSucceeds(roll.die, modifiers);

  const roomId = raw.slice("room:".length);
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, discordThreadId: true },
  });
  const openTurn = await getOpenTurn();

  // The die lives here and NOWHERE a player can read it. The per-line
  // TRANSFER_TAG rows above are the record of what moved and the thing Undo
  // reads; this row is the record of the roll.
  await logAudit(prisma, {
    actorDiscordUserId: session.discordUserId,
    actionType: "steal",
    targetCharacterId: character.id,
    turnId: openTurn?.id ?? null,
    place: room ? placeKeyForRoom(room.id) : character,
    details: {
      roomId,
      roomName: room?.name ?? null,
      die: roll.die,
      rolls: roll.rolls,
      advantage: roll.advantage,
      modifiers,
      total: stealTotal(roll.die, modifiers),
      unseen,
    },
  });

  // On a success, nothing is posted anywhere — no Discord line and no scene
  // row, which is the whole of the verb. announceInRoom already names the
  // thief by the face the room saw, so a hooded one reads as "A young man".
  if (!unseen && room) after(() => announceInRoom(room, character, CAUGHT_LINE));

  return {};
}
