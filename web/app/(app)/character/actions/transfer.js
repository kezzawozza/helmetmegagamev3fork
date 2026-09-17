// The merged transfer dialog (resources/items/tags between parties).

import { after } from "next/server";
import {
  prisma,
  placeKeyForRoom,
} from "@lifeweb/db";
import {
  applyTransfer,
  InsufficientResourcesError,
} from "@lifeweb/db/lib/resourceTransfer";
import { getOpenTurn } from "@/lib/turn";
import { INDESTRUCTIBLE_SLUGS } from "@lifeweb/db/lib/nuke";
import { isResourcesRow } from "@lifeweb/db/lib/resourceStack";
import {
  presentedIdentity,
  forcedNameFrom,
  concealmentFrom,
} from "@lifeweb/db/lib/presentedIdentity";
import { aliasSubject } from "@lifeweb/db/lib/concealedIdentity";
import { logAudit } from "@/lib/requests";
import { UserError } from "@/lib/actionResult";
import { isTradeable } from "@/lib/tagRequests";
import {
  addToStack,
  dropCharacterTag,
  takeTagFrom,
  giveTagTo,
} from "@/lib/tagEffects";
import {
  canReachParty,
  outOfReachMessage,
} from "@/lib/transferReach";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { announceInRoom } from "@lifeweb/db/lib/roomAnnounce";
import {
  dropRoomTag,
  lockRoom,
} from "@lifeweb/db/lib/tagWrites";
import {
  carryAdmits,
  rowWeight,
} from "@lifeweb/db/lib/carry";
import { formatManifest } from "@lifeweb/db/lib/roomStash";
import { notifyCharacter } from "@/lib/notifyCharacter";
import {
  INCAPACITATING_SLUGS,
  ACT,
} from "@lifeweb/db/lib/incapacitation";
import {
  requireCharacter,
  revalidateAll,
  parseCount,
  resolveParty,
} from "./shared.js";
import { lootCharacterRequestImpl } from "./misc.js";

// --- Transfer (the merged dialog) -------------------------------------

// One act that moves any number of tag lines and a ⬢ amount between two
// parties: yourself, a person standing here, or a Room stash at your
// Location (docs/systemdocs/CARRY.md). Files one TRANSFER_TAG per tag line
// and one TRANSFER_RESOURCES for the ⬢, all in one transaction, so a GM can
// still undo any single piece from /gm/turns.
//
// Things and ⬢ leave YOU, a room, or a HELPLESS person — bound, dying,
// paralyzed, catatonic, or a body (REQUESTS.md §5b). That last case is Loot
// wearing Transfer's clothes, and it is handed to lootCharacterRequestImpl
// rather than reimplemented here. An upright person is still refused: listing
// what is in their pockets would show their hidden tags.

// `options` is a SECOND parameter, and it has to stay one. requestActions.js
// calls this as `guarded(() => transferRequestImpl(input))` and hands the
// client's whole input object straight through, so anything read off `input`
// is settable by whoever is typing in the browser — an `announceTake: false`
// posted from a console would let any player empty every stash in the game in
// silence. As a second argument it is unreachable from the browser, and
// actions/steal.js is the only caller that passes it.
export async function transferRequestImpl(
  {
    fromKey,
    toKey,
    tags: rawTags,
    amount: rawAmount,
  },
  { announceTake = true } = {},
) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const amount =
    rawAmount == null || rawAmount === ""
      ? 0
      : parseCount(rawAmount, { min: 0 });
  if (amount == null) throw new UserError("Amount must be a whole number.");
  const lines = Array.isArray(rawTags)
    ? rawTags.map((t) => ({
        tagId: String(t?.tagId ?? ""),
        quantity: parseCount(t?.quantity ?? 1, { min: 1 }),
      }))
    : [];
  if (lines.some((l) => !l.tagId || l.quantity == null)) {
    throw new UserError("Each line needs a tag and a whole number.");
  }
  if (new Set(lines.map((l) => l.tagId)).size !== lines.length)
    throw new UserError("A tag is listed twice.");
  if (amount === 0 && lines.length === 0)
    throw new UserError("Nothing to move.");

  // A "hood:<token>" key names a concealed person by an opaque handle rather
  // than an id, so the browser is never told who is under the mask
  // (db/lib/whosHere.js). resolveParty knows both shapes now (actions/shared.js)
  // and re-checks co-presence itself, so a token minted in a room this
  // character has since left names nobody.
  //
  // `allowDead` on the SOURCE only: taking things off a corpse is the whole
  // point of a loot-shaped transfer, while handing something TO a body is not
  // a thing. Loot resolves its target the same way.
  const [from, to] = await Promise.all([
    resolveParty(fromKey, { actor: character, allowDead: true }),
    resolveParty(toKey, { actor: character }),
  ]);
  if (!from) throw new UserError("Unknown source.");
  if (!to) throw new UserError("Unknown recipient.");
  if (from.kind === to.kind && from.id === to.id)
    throw new UserError("Source and recipient are the same.");

  // Taking from another person IS Loot, and it stays Loot: this hands the
  // whole job to lootCharacterRequestImpl rather than growing a second
  // implementation beside it. That is what keeps the helpless gate
  // (INCAPACITATING_SLUGS — Bound, Dying, Paralyzed, Catatonic, or a body),
  // the ROBBED mood hit and the "your body was searched" notification from
  // depending on which button was pressed.
  //
  // It has to land in YOUR hands, the same rule Loot has always had — there is
  // no verb for going through somebody's pockets straight into a cupboard.
  if (from.kind === "character" && from.id !== character.id) {
    if (!(to.kind === "character" && to.id === character.id)) {
      throw new UserError("Taking from a person puts it in your own hands.");
    }
    return lootCharacterRequestImpl({
      targetCharacterId: from.id,
      tagPicks: lines.map((l) => ({ tagId: l.tagId, quantity: l.quantity })),
      amount,
    });
  }
  // Both ends have to be where you stand — re-checked here on the posted
  // key, the same predicate that built the menu (web/lib/peopleHere.js). A
  // room adds "and its door opens for you". No exceptions either way: the
  // faction silo was the one, and it went with the silos.
  const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
  for (const party of [from, to]) {
    if (!(await canReachParty(character, party, { heldSlugs, allowConcealed: true }))) {
      throw new UserError(outOfReachMessage(party));
    }
  }
  if (amount > from.balance)
    throw new UserError(`${from.name} only has ${from.balance} ⬢.`);

  // Resolve every tag line against the SOURCE's holdings, snapshotting what
  // Undo will need to put back.
  const lineIds = lines.map((l) => l.tagId);
  let holdings = [];
  if (lines.length && from.kind === "room") {
    holdings = await prisma.roomTag.findMany({
      where: { roomId: from.id, tagId: { in: lineIds } },
      select: {
        tagId: true,
        quantity: true,
        expiresTurn: true,
        tag: { select: { name: true, stackable: true, tradeable: true } },
      },
    });
  } else if (lines.length) {
    holdings = character.tags
      .filter((ct) => lineIds.includes(ct.tagId))
      .map((ct) => ({
        tagId: ct.tagId,
        quantity: ct.quantity,
        expiresTurn: ct.expiresTurn,
        source: ct.source,
        tag: ct.tag,
      }));
  }
  // A non-stackable tag pins at one per character (tagWrites.js#addToStack),
  // so a pull out of a room is clamped to 1 here — silently moving 1 while
  // the request says 2 would make Undo take 2 back. Someone who already
  // holds one can't take a second at all.
  const recipientHeld =
    lines.length && to.kind === "character"
      ? new Set(
          (
            await prisma.characterTag.findMany({
              where: { characterId: to.id, tagId: { in: lineIds } },
              select: { tagId: true },
            })
          ).map((ct) => ct.tagId),
        )
      : new Set();
  const moves = lines.map((line) => {
    const held = holdings.find((h) => h.tagId === line.tagId);
    if (!held) {
      throw new UserError(
        from.kind === "room"
          ? "That isn't there any more."
          : "You don't have that tag.",
      );
    }
    if (!isTradeable(held.tag))
      throw new UserError("That isn't something that can change hands.");
    // ⬢ are a tradeable stack row and would pass the line above, but this
    // dialog has its own ⬢ field and THAT is the ledgered path — applyTransfer
    // books one row for the movement, a tag pick books none. The picker leaves
    // them out (web/lib/tagRequests.js), and a picker is a hint, not a lock.
    if (isResourcesRow(held))
      throw new UserError("Move ⬢ with the Resources field, not as an item.");
    let max = held.quantity;
    if (!held.tag.stackable && to.kind === "character") {
      if (recipientHeld.has(line.tagId))
        throw new UserError(`${to.name} already has ${held.tag.name}.`);
      max = 1;
    }
    const quantity = Math.min(line.quantity, max);
    return { tagId: line.tagId, quantity, held };
  });

  // The ceiling (docs/systemdocs/CARRY.md §2). A deliberate hand-over is
  // REFUSED past 1.5× the recipient's cap rather than landing and being partly
  // scattered on the floor — otherwise handing someone 300 lb would shed a
  // random slice of what they were already carrying into a public room.
  // Checked only for a character on the receiving end; a Room stash is
  // bottomless.
  if (to.kind === "character") {
    const recipient = await prisma.character.findUnique({
      where: { id: to.id },
      // The tags ARE the whole load now, ⬢ included — they weigh a pound each
      // like anything else, so there is no second balance to select.
      select: {
        tags: { select: { quantity: true, equipped: true, tag: true } },
      },
    });
    const config = await prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: { carryWeightLbs: true },
    });
    const addedLbs = moves.reduce(
      (sum, m) => sum + rowWeight({ ...m.held, quantity: m.quantity }),
      0,
    );
    const verdict = carryAdmits(recipient, config, {
      weightLbs: addedLbs,
      resources: amount,
    });
    if (!verdict.ok) {
      throw new UserError(
        to.id === character.id
          ? verdict.reason
          : `${to.name} couldn't carry that. ${verdict.reason}`,
      );
    }
  }

  const openTurn = await getOpenTurn();
  const ledger = {
    actorDiscordUserId: session.discordUserId,
    actorCharacterId: character.id,
    actorName: character.name,
    turnNumber: openTurn?.number ?? null,
    dayNumber: openTurn?.dayNumber ?? null,
    note: null,
  };
  const fromParty = { kind: from.kind, id: from.id, name: from.name };
  const toParty = { kind: to.kind, id: to.id, name: to.name };
  // Two fields the audit log carries on every hand-to-hand move, and the
  // reason both are written HERE rather than resolved when a row is drawn.
  //
  // `by` is the name the room saw, frozen the way ArchiveEntry.concealedAlias
  // is: resolving it live would unmask every deposit somebody ever made the
  // moment the hood came off. No extra query — requireCharacter already loads
  // whole Tag rows with `equipped`, which is all forcedNameFrom and
  // concealmentFrom read.
  //
  // `moveId` ties one act together. This writes one audit row per tag stack
  // plus one for the ⬢, so handing in two stacks and 30 ⬢ is three rows; a
  // reader groups on this to print it as the one thing it was.
  const identity = presentedIdentity(character, {
    forcedName: forcedNameFrom(character.tags),
    concealment: concealmentFrom(character.tags),
  });
  const by = identity.name;
  // The recipient's DM names the giver the way shout.js does: a hood gets "A young man", not the Title Case alias.
  const giver = identity.concealed ? aliasSubject(character) : identity.name;
  const moveId = crypto.randomUUID();
  // The Spillway (Room.destroysContents). Nothing is written on the receiving
  // end — giveTagTo and moveParty both refuse — so the effect has to say so,
  // or a GM repairing this by hand goes looking for goods never stored.
  // ...but not everything the trough is handed goes over the edge. The nuclear
  // device and its datacard settle at the bottom intact (db/lib/nuke.js), so a
  // transfer of nothing but those is NOT a destruction, and neither the audit
  // row nor the line the room hears may claim it was.
  const survives = moves.filter((m) => INDESTRUCTIBLE_SLUGS.has(m.held?.tag?.slug));
  const destroyed = to.destroysContents === true && survives.length < moves.length;
  const nothingDestroyed = to.destroysContents === true && survives.length === moves.length;
  const fromCharacterId = from.kind === "character" ? from.id : null;
  const toCharacterId = to.kind === "character" ? to.id : null;

  await prisma.$transaction(async (tx) => {
    // A room-to-room move (two public rooms at one Location — the Keep alone
    // has five) would otherwise lock from-room then to-room in request order
    // inside the primitives, and the reverse-direction transfer locks them
    // the other way round — the same 40P01 AB-BA trap the character locks
    // below this file already defend against with a sorted order. Pre-lock
    // both rooms sorted; the primitives' own lockRoom re-acquisitions inside
    // this transaction are then no-ops.
    if (from.kind === "room" && to.kind === "room") {
      for (const roomId of [from.id, to.id].sort()) await lockRoom(tx, roomId);
    }
    for (const move of moves) {
      const { tagId, quantity, held } = move;
      const restore = {
        source: held.source ?? "EVENT",
        expiresTurn: held.expiresTurn ?? null,
        quantity,
      };
      // Poison state (M4) rides along on the same primitive an ordinary
      // hand-over uses: what leaves is a hypergeometric draw against the
      // source row (takeTagFrom/dropCharacterTag/dropRoomTag), and what
      // lands merges into the recipient row under the "poisons don't mix"
      // dilution rule (giveTagTo/restoreCharacterTag/addToRoomStack). Never
      // surfaced in the audit `details` below — that would tell whoever can
      // read this row back (a GM, but also a stale-tab replay) something the
      // plain manifest never has.
      const { poisonedTaken, poisonPayload } = await takeTagFrom(tx, from, tagId, quantity);
      await giveTagTo(tx, to, {
        tagId,
        quantity,
        expiresTurn: held.expiresTurn ?? null,
        source: "EVENT",
        poisonedCount: poisonedTaken,
        poisonPayload,
      });
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_transfer_tag",
        targetCharacterId: toCharacterId ?? fromCharacterId,
        // Whichever end is a room IS the room this happened in; a
        // character-to-character hand-off has none, so falls back to the
        // acting character's location.
        place: from.kind === "room" ? placeKeyForRoom(from.id) : to.kind === "room" ? placeKeyForRoom(to.id) : character,
        details: {
          tagId,
          tagName: held.tag.name,
          quantity,
          from: fromParty,
          to: toParty,
          by,
          moveId,
          direction: "SEND",
          restore,
        },
      });
    }

    if (amount > 0) {
      try {
        await applyTransfer(
          tx,
          { from, to, amount, ledger },
          {
            reason: "TRANSFER",
            actionType: "request_transfer_resources",
            actorDiscordUserId: character.discordUserId ?? null,
            zoneId: character.zoneId ?? null,
            turnId: openTurn?.id ?? null,
            turnNumber: openTurn?.number ?? null,
          },
        );
      } catch (err) {
        if (!(err instanceof InsufficientResourcesError)) throw err;
        throw new UserError(err.message);
      }
      const effect = {
        amount,
        from: fromParty,
        to: toParty,
        by,
        moveId,
        direction: "SEND",
        destroyed,
      };
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_transfer_resources",
        targetCharacterId: toCharacterId ?? fromCharacterId ?? character.id,
        place: from.kind === "room" ? placeKeyForRoom(from.id) : to.kind === "room" ? placeKeyForRoom(to.id) : character,
        details: effect,
      });
    }
  });

  await afterInventoryChange([fromCharacterId, toCharacterId]);

  const goods = formatManifest(
    moves.map((m) => ({ tagName: m.held.tag.name, quantity: m.quantity })),
    amount,
  );
  if (toCharacterId && toCharacterId !== character.id) {
    notifyCharacter(
      { id: to.id, discordUserId: to.discordUserId },
      `${giver} handed you ${goods}.`,
    );
  }
  // The room hears about it, aliased (CARRY.md): leaving something is public
  // by nature, and so is walking off with it.
  if (to.kind === "room") {
    // "Leaves it here" would be a lie about the Spillway — the trough is the
    // point of the room, and anyone watching sees it go over the edge.
    after(() =>
      announceInRoom(
        to,
        character,
        destroyed
          ? `tips ${goods} into the trough. It is gone.`
          : nothingDestroyed
            ? `tips ${goods} into the trough. It settles at the bottom, intact.`
            : `leaves ${goods} here.`,
      ),
    );
  }
  // Steal is the one taker that suppresses this (docs/systemdocs/THEFT.md §1):
  // it posts its own line, and only when the roll went badly.
  if (from.kind === "room" && announceTake)
    after(() => announceInRoom(from, character, `takes ${goods}.`));

  revalidateAll();
  return {};
}

