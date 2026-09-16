// Pickpocket (docs/systemdocs/THEFT.md §2): going through a standing person's
// pockets.
//
// Two acts, one row. `pickpocketRequestImpl` rolls and claims; if the roll was
// any good it hands back what the target is carrying, and
// `pickpocketTakeImpl` moves whatever the thief ticked. The PickpocketAttempt
// row is the ration AND the authorization for the second half — see the model's
// own comment in schema.prisma for why it is one row and why it is not an Offer.
//
// This is NOT Loot. Loot needs its target helpless, hits them with a ROBBED
// mood and tells them their body was searched. The whole point here is that on
// a good roll nobody is told anything at all.

import { prisma } from "@lifeweb/db";
import { rollWithAdvantage } from "@lifeweb/db/lib/advantage";
import {
  FAILED,
  NOTICED,
  holdsPickpocket,
  pickpocketBonus,
  pickpocketBudgetLbs,
  pickpocketOutcome,
  pickpocketTook,
  pickpocketableHoldings,
  weighPicks,
} from "@lifeweb/db/lib/pickpocket";
import { isHere } from "@lifeweb/db/lib/presence";
import { ACT, blockerFor } from "@lifeweb/db/lib/incapacitation";
import { capitalizeFirst } from "@lifeweb/db/lib/concealedIdentity";
import { seenAs, identityOf, IDENTITY_SELECT } from "@lifeweb/db/lib/intercept";
import { CONCEALMENT_TAG_FIELDS } from "@lifeweb/db/lib/presentedIdentity";
import { resolveHoodToken } from "@lifeweb/db/lib/whosHere";
import { carryAdmits } from "@lifeweb/db/lib/carry";
import { rowWeight, round2 } from "@lifeweb/db/lib/tagWeight";
import { dropCharacterTag, addToStack } from "@/lib/tagEffects";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { UserError } from "@/lib/actionResult";
import { requireCharacter, revalidateAll, parseCount, lockCharacter } from "./shared.js";

// Bascinet's words, verbatim. Both name the thief by the face the room saw, so
// a hooded one reads "A young man pickpocketed you!".
const NOTICED_DM = (who) => `${who} pickpocketed you!`;
const FAILED_DM = (who) => `${who} tried to pickpocket you, but failed!`;

// A superset of IDENTITY_SELECT, and `tags` OVERRIDES rather than merges —
// the single most breakable line here, exactly as SEARCH_SELECT's comment says
// of its own. Drop CONCEALMENT_TAG_FIELDS and presentedIdentity reports every
// hood as a bare face, so a refusal unmasks somebody. Drop `category` and the
// Assets rule in pickpocketableHoldings reads undefined, which would put every
// weightless horse and deed back on the table. Drop `stackable` and every take
// silently pins to 1.
const PICKPOCKET_SELECT = {
  ...IDENTITY_SELECT,
  resources: true,
  tags: {
    where: { quantity: { gt: 0 } },
    select: {
      tagId: true,
      quantity: true,
      equipped: true,
      expiresTurn: true,
      source: true,
      tag: {
        select: {
          id: true,
          name: true,
          slug: true,
          category: true,
          tradeable: true,
          stackable: true,
          weightLbs: true,
          forcedName: true,
          ...CONCEALMENT_TAG_FIELDS,
        },
      },
    },
  },
};

// searchAuthority's shape and, where the question is the same, its exact
// sentences. Every refusal names the target by the face the room saw and never
// by the row — a refusal is the last place to out somebody (INTERCEPT.md §2).
function pickpocketAuthority(actor, target) {
  if (!actor || !target) return "They aren't here.";
  if (actor.id === target.id) return "Pick somebody else's pocket.";
  if (actor.status !== "ALIVE") return "You can't do that right now.";
  if (target.status !== "ALIVE") return `${capitalizeFirst(seenAs(identityOf(target)))} isn't here.`;
  // allowConcealed, the Search posture: a hood hides who you are, not what is
  // in your pockets.
  if (!isHere(actor, target, { allowConcealed: true }))
    return `${capitalizeFirst(seenAs(identityOf(target)))} isn't here.`;

  const mine = blockerFor(actor.tags, ACT);
  if (mine) return `You're ${mine.name}.`;
  const theirs = blockerFor(target.tags, ACT);
  if (theirs) return `${capitalizeFirst(seenAs(identityOf(target)))} is ${theirs.name}.`;
  return null;
}

// "hood:<token>" -> an id, or the bare id. resolveHoodToken re-checks
// co-presence itself, so a token minted in a room this character has since left
// answers null — which is what stops the token being a roster oracle.
async function resolveTarget(character, targetKey) {
  const raw = String(targetKey ?? "");
  const bare = raw.startsWith("character:") ? raw.slice("character:".length) : raw;
  const id = bare.startsWith("hood:")
    ? await resolveHoodToken(prisma, character, bare.slice("hood:".length))
    : bare;
  if (!id) return null;
  return prisma.character.findFirst({ where: { id }, select: PICKPOCKET_SELECT });
}

// What the thief is shown. A plain name and a weight, and NO tag chip — the
// MoveThingsDialog helpless-pockets rule (REQUESTS.md §5b): the filter here is
// `tradeable` rather than `catalogVisibility`, so a secret tag is already named
// in this list, and handing over its description, recipe and cost as well would
// be a second leak on top of the one the verb is for.
function holdingRows(target) {
  return pickpocketableHoldings(target.tags).map((ct) => ({
    tagId: ct.tagId,
    name: ct.tag.name,
    quantity: ct.quantity,
    stackable: Boolean(ct.tag.stackable),
    each: rowWeight({ ...ct, quantity: 1 }),
  }));
}

// ─── Phase 1: the roll ─────────────────────────────────────────────────────

export async function pickpocketRequestImpl({ targetKey }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  // Re-checked server-side. The greyed button is a hint, never a lock.
  if (!holdsPickpocket(character.tags)) throw new UserError("You don't know how to do that.");

  const target = await resolveTarget(character, targetKey);
  if (!target) throw new UserError("They aren't here.");
  const refusal = pickpocketAuthority(character, target);
  if (refusal) throw new UserError(refusal);

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  const bonus = pickpocketBonus(character.tags);
  const budgetLbs = pickpocketBudgetLbs(character.tags);
  const roll = rollWithAdvantage(character.tags, 6);
  const outcome = pickpocketOutcome(roll.die + bonus);

  // The insert IS the claim. A P2002 means this target was already tried this
  // turn — EXCEPT when the existing row is this turn's and untouched, in which
  // case the thief refreshed the page or reopened the dialog and gets the SAME
  // die back rather than losing the attempt or rerolling into a better one.
  // `fresh` is what stops a reopened dialog re-sending the target's DM: only
  // the roll that actually happened is allowed to speak.
  let attempt;
  let fresh = true;
  try {
    attempt = await prisma.pickpocketAttempt.create({
      data: {
        thiefId: character.id,
        targetCharacterId: target.id,
        turnId: openTurn.id,
        die: roll.die,
        bonus,
        outcome,
        budgetLbs,
      },
    });
    await logAudit(prisma, {
      actorDiscordUserId: session.discordUserId,
      actionType: "pickpocket",
      targetCharacterId: target.id,
      turnId: openTurn.id,
      place: character,
      // `presented`, never the row name (INTERCEPT.md §2). The die lives here
      // and on the attempt row, and nowhere a player can read it.
      details: {
        presented: seenAs(identityOf(target)),
        attemptId: attempt.id,
        die: roll.die,
        rolls: roll.rolls,
        advantage: roll.advantage,
        bonus,
        outcome,
        budgetLbs,
      },
    });
  } catch (err) {
    if (err?.code !== "P2002") throw err;
    fresh = false;
    attempt = await prisma.pickpocketAttempt.findUnique({
      where: {
        thiefId_targetCharacterId_turnId: {
          thiefId: character.id,
          targetCharacterId: target.id,
          turnId: openTurn.id,
        },
      },
    });
    if (!attempt || attempt.spentLbs > 0)
      throw new UserError(`You already went through ${seenAs(identityOf(target))}'s pockets this turn.`);
  }

  if (attempt.outcome === FAILED) {
    if (fresh) notifyCharacter(target, FAILED_DM(capitalizeFirst(seenAs(identityOf(character)))));
    revalidateAll();
    // Nothing moves, and the thief is told nothing about the die beyond this.
    return { outcome: FAILED };
  }

  // CLEAN and NOTICED return the IDENTICAL payload. If the thief could tell a 5
  // from a 2 from what comes back, the die would be readable off the dialog and
  // a noticed theft would just be one you re-plan around. The target's DM is
  // the only thing that differs, and it is sent at the TAKE, not here — a hand
  // in a pocket that took nothing is not something to notice.
  revalidateAll();
  return {
    outcome: "took",
    targetId: target.id,
    targetName: seenAs(identityOf(target)),
    budgetLbs: attempt.budgetLbs,
    spentLbs: attempt.spentLbs,
    rows: holdingRows(target),
  };
}

// ─── Phase 2: the take ─────────────────────────────────────────────────────

export async function pickpocketTakeImpl({ targetKey, tags: rawTags }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  if (!holdsPickpocket(character.tags)) throw new UserError("You don't know how to do that.");

  const lines = Array.isArray(rawTags)
    ? rawTags.map((t) => ({ tagId: String(t?.tagId ?? ""), quantity: parseCount(t?.quantity ?? 1, { min: 1 }) }))
    : [];
  if (lines.some((l) => !l.tagId || l.quantity == null))
    throw new UserError("Each line needs a tag and a whole number.");
  if (new Set(lines.map((l) => l.tagId)).size !== lines.length) throw new UserError("A tag is listed twice.");
  if (!lines.length) throw new UserError("Nothing to take.");

  // Everything is re-resolved from the session. The browser names the target
  // and nothing else, and even that is re-checked.
  const target = await resolveTarget(character, targetKey);
  if (!target) throw new UserError("They aren't here.");
  const refusal = pickpocketAuthority(character, target);
  if (refusal) throw new UserError(refusal);

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  // The authorization. Keyed on the CURRENTLY open turn, so a turn boundary
  // invalidates it for free with no sweep — and re-running pickpocketAuthority
  // above is the walk-away rule, which is why this verb needs no cancel hook in
  // locationMove.js the way a pending Search offer does.
  const attempt = await prisma.pickpocketAttempt.findUnique({
    where: {
      thiefId_targetCharacterId_turnId: {
        thiefId: character.id,
        targetCharacterId: target.id,
        turnId: openTurn.id,
      },
    },
  });
  if (!attempt || !pickpocketTook(attempt.outcome))
    throw new UserError("Your hand isn't in their pocket.");

  // Against a FRESH read of what they hold — the picker may be minutes old, and
  // they may have handed the thing away since.
  const reachable = new Map(pickpocketableHoldings(target.tags).map((ct) => [ct.tagId, ct]));
  const held = new Set(character.tags.map((ct) => ct.tagId));
  const moves = lines.map((line) => {
    const row = reachable.get(line.tagId);
    if (!row) throw new UserError("They aren't carrying that.");
    // The non-stackable pin (tagWrites.js#addToStack): a clamp rather than a
    // silent move of 1 against a request for 2, or Undo would take 2 back.
    let max = row.quantity;
    if (!row.tag.stackable) {
      if (held.has(line.tagId)) throw new UserError(`You already have ${row.tag.name}.`);
      max = 1;
    }
    return { tagId: line.tagId, quantity: Math.min(line.quantity, max), held: row };
  });

  // Rounded before the compare, the round2 the rest of the app already uses on
  // a summed weight. Unrounded, half a dozen 0.5 lb vials sum to 15.000000000002
  // and a take that lands exactly on the budget is refused for no visible
  // reason — the single most confusing way this could misbehave.
  const takenLbs = round2(weighPicks(moves));
  const leftLbs = round2(attempt.budgetLbs - attempt.spentLbs);
  if (takenLbs > leftLbs)
    throw new UserError(`That's more than you could lift unnoticed — ${leftLbs} lb left.`);

  // The thief's own ceiling. Refused rather than landed-and-shed: past 1.5× the
  // cap settleCarry sheds NEWEST-first into a public room with a line in it
  // (CARRY.md §5), which would announce a silent theft one second after it
  // succeeded.
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { carryWeightLbs: true, carryResourceCap: true },
  });
  const verdict = carryAdmits(
    { resources: character.resources, tags: character.tags },
    config,
    { weightLbs: takenLbs, resources: 0 },
  );
  if (!verdict.ok) throw new UserError(verdict.reason);

  await prisma.$transaction(async (tx) => {
    // Sorted-id locking, the lootCharacterRequestImpl deadlock discipline: two
    // thieves picking each other at the same instant would otherwise lock in
    // opposite orders, and Postgres surfaces that as a raw 40P01.
    for (const id of [character.id, target.id].sort()) await lockCharacter(tx, id);

    // The budget claim is a conditional updateMany whose WHERE is the check, so
    // two tabs cannot both spend the last pound. It goes FIRST: a refusal here
    // rolls back everything under it.
    const claimed = await tx.pickpocketAttempt.updateMany({
      where: { id: attempt.id, spentLbs: attempt.spentLbs },
      data: { spentLbs: round2(attempt.spentLbs + takenLbs) },
    });
    if (claimed.count !== 1) throw new UserError("Your hand isn't in their pocket.");

    for (const move of moves) {
      // Re-read under the lock: dropCharacterTag on an already-gone row is a
      // silent no-op, so a loser of the race would look successful and take
      // nothing.
      const fresh = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: target.id, tagId: move.tagId } },
        select: { quantity: true, expiresTurn: true, source: true },
      });
      if (!fresh || fresh.quantity < move.quantity) throw new UserError("They aren't carrying that.");

      const { poisonedTaken, poisonPayload } = await dropCharacterTag(tx, target.id, move.tagId, move.quantity);
      await addToStack(tx, character.id, move.tagId, move.quantity, {
        source: fresh.source,
        expiresTurn: fresh.expiresTurn,
        stackable: Boolean(move.held.tag.stackable),
        poisonedCount: poisonedTaken,
        poisonPayload,
      });

      // One TRANSFER_TAG per line, the Transfer shape, so a GM can undo any
      // single piece of this from /gm/turns.
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_transfer_tag",
        targetCharacterId: target.id,
        turnId: openTurn.id,
        place: character,
        details: {
          tagId: move.tagId,
          tagName: move.held.tag.name,
          quantity: move.quantity,
          from: { kind: "character", id: target.id },
          to: { kind: "character", id: character.id },
          fromCharacterId: target.id,
          toCharacterId: character.id,
          via: "pickpocket",
          restore: { source: fresh.source, expiresTurn: fresh.expiresTurn, quantity: move.quantity },
        },
      });
    }

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "pickpocket_took",
      targetCharacterId: target.id,
      turnId: openTurn.id,
      place: character,
      details: {
        presented: seenAs(identityOf(target)),
        attemptId: attempt.id,
        outcome: attempt.outcome,
        takenLbs,
        budgetLbs: attempt.budgetLbs,
        lines: moves.map((m) => ({ tagId: m.tagId, tagName: m.held.tag.name, quantity: m.quantity })),
      },
    });
  });

  await afterInventoryChange([character.id, target.id]);

  // The DM fires at the TAKE and not at the roll, which is the honest reading:
  // you notice a hand in your pocket because something left it. A thief who
  // opened the picker and cancelled escapes notice — the spent ration is the
  // brake on doing that all afternoon.
  if (attempt.outcome === NOTICED)
    notifyCharacter(target, NOTICED_DM(capitalizeFirst(seenAs(identityOf(character)))));

  // Nothing is posted to the room, on any outcome.
  revalidateAll();
  return {};
}
