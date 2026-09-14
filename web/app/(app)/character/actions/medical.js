// Healing a character, and the per-turn heal-routine counter it shares
// only with itself.

import { prisma } from "@lifeweb/db";
import { getOpenTurn } from "@/lib/turn";
import {
  logAudit,
  craftAllowance,
  unitsOfTagThisTurn,
  deadSimpleUnitsThisTurn,
  MEDICAL_SIMPLE_PER_TURN,
} from "@/lib/requests";
import { craftMoveCost } from "@/lib/craftBudget";
import { UserError } from "@/lib/actionResult";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";
import {
  requireFreeMove,
  fileAutoRoutine,
} from "@/lib/moveSpend";
import { craftFamily } from "@/lib/tagRequests";
import {
  debitResources,
  dropCharacterTag,
  grantTagSlugs,
} from "@/lib/tagEffects";
import {
  HEAL_SKILL_SLUG,
  buildSkillAncestry,
  countsAgainstHealCap,
  healCost,
  isGambitHeal,
  isHealable,
  needsSurgicalSite,
  satisfiedSkillIds,
} from "@/lib/healRequests";
import {
  canReachParty,
  outOfReachMessage,
} from "@/lib/transferReach";
import {
  isHere,
  notHereMessage,
} from "@/lib/peopleHere";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { consumeInspiredIfUsed } from "@lifeweb/db/lib/tagWrites";
import {
  SURGICAL_EQUIPMENT_SLUG,
  PORTABLE_SURGICAL_PACK_SLUG,
} from "@lifeweb/db/lib/constants";
import { hasEquipmentInReach } from "@lifeweb/db/lib/equipmentReach";
import { rollWithAdvantage } from "@lifeweb/db/lib/advantage";
import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import { rollTagChain } from "@lifeweb/db/lib/tagShapes";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { ACT } from "@lifeweb/db/lib/incapacitation";
import {
  applyMood,
  woundMoodFor,
} from "@lifeweb/db/lib/mood";
import {
  requireCharacter,
  revalidateAll,
  parseCount,
  resolveParty,
  lockCharacter,
  resolveCraftMove,
  spendCraftMove,
  craftLedgerEntry,
} from "./shared.js";

// --- Tags -------------------------------------------------------------

// The two per-turn craft counters — `unitsOfTagThisTurn` and
// `deadSimpleUnitsThisTurn` — now live in web/lib/requests.js beside
// `craftAllowance`, because character/page.js has to read the same numbers to
// tell the Craft dialog how many free units are left.

// 0-turn cures already worked this turn, against MEDICAL_SIMPLE_PER_TURN
// (M2, docs/systemdocs/TAGS.md §5c) — the shared free-first-aid pool.
//
// Counts REQUESTS, not units — one heal is one patient — and only the ones
// that cost NO turn of work: a turns-costing cure never draws on this pool at
// all any more, it bills the medical family's Move instead
// (healCharacterRequestImpl below). A gambit heal is never in here either,
// because it files a Move and the Action unique constraint rations those on
// its own. INVERTED from the pre-M2 predicate (`turns > 0`), which counted
// this pool's opposite against the old per-tier daily cap.
// Keyed on the MEDIC — actorDiscordUserId — and NOT on targetCharacterId,
// which is the patient the row is about. Counting the patient's axis caps the
// wrong person: a medic treating other people would never be counted at all,
// and someone who had been treated four times could not treat anybody.
async function routineHealsThisTurn(db, discordUserId, turnId) {
  if (!turnId || !discordUserId) return 0;
  const filed = await db.auditLog.findMany({
    where: { actorDiscordUserId: discordUserId, actionType: "request_heal_character", turnId },
    select: { details: true },
  });
  return filed.filter(
    (r) => !r.details?.gambit && (r.details?.requirement?.turns ?? 0) === 0,
  ).length;
}

// --- Healing ----------------------------------------------------------

// Treating someone else's affliction — the only request whose subject isn't
// the filer, so most ids below are the TARGET's. Three gates, all
// re-checked here: the medic holds a Medical skill, the patient is standing
// here (web/lib/peopleHere.js), and the affliction's own requirementSkills
// are satisfied. The PAYER is ungated beyond being here, same bet as Craft.
export async function healCharacterRequestImpl({
  targetCharacterId,
  tagId,
  payerKey,
  // Mirrors craftRequestImpl's billedSeen contract (CRAFTING.md §2a): 1 if
  // the dialog showed this as costing the Move, 0 if it showed free. The
  // server never bills more than the dialog acknowledged — a stale pool
  // reading that would silently spend a Move gets the "reload" refusal
  // instead (review fix, M2).
  billedSeen: rawBilledSeen,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId) {
    throw new UserError("You aren't anywhere you could treat someone.");
  }

  // The flat catalog, so holding a higher tier still satisfies a requirement
  // written against the base skill.
  const catalog = await prisma.tag.findMany({
    select: { id: true, slug: true, parentTagId: true },
  });
  const ancestry = buildSkillAncestry(catalog);
  const satisfied = satisfiedSkillIds(
    character.tags.map((ct) => ct.tagId),
    ancestry,
  );
  const healSkillId = catalog.find((t) => t.slug === HEAL_SKILL_SLUG)?.id;
  if (!healSkillId || !satisfied.has(healSkillId)) {
    throw new UserError("You need Medical (Basic) to treat anyone.");
  }

  // No `id: { not: character.id }` — treating yourself is the ordinary case.
  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    include: {
      tags: { include: { tag: { include: { requirementSkills: true } } } },
    },
  });
  if (!target || !isHere(character, target))
    throw new UserError(notHereMessage(target));

  const held = target.tags.find((ct) => ct.tagId === tagId);
  if (!held || !isHealable(held.tag))
    throw new UserError("That isn't something you can treat.");

  // Above your tier, or the top rung of the ladder, and it is a GAMBIT rather
  // than a refusal (docs/systemdocs/TAGS.md §5c). Nothing is out of reach any
  // more; what changes is whether you roll for it.
  const gambit = isGambitHeal(held.tag, satisfied);
  // Surgery needs a site (M3, TAGS.md §5c; reworked M6b): a tier-6/7 cure —
  // read off the cure's own required skill, needsSurgicalSite — refuses
  // outright without SOMETHING enabling the site. Two things can enable it
  // now: the fixed Surgical Equipment kit (or a COMPLETE Surgical Theater,
  // which hasEquipmentInReach already treats as satisfying the same reach —
  // the same way a Forge satisfies Workshop Equipment), or, failing that, a
  // Portable Surgical Pack. Neither is consumed; both are ordinary standing
  // held/room-stashed gear.
  //
  // The two are NOT equivalent. A real site (fixed kit or Theater) carries no
  // penalty at all — it is simply what surgery is supposed to look like. The
  // portable pack is a worse stand-in: when it's the ONLY thing enabling the
  // site, the Gambit rolls at −1. Reaching for the fixed kit or a Theater
  // always wins outright and erases the penalty; the portable never adds a
  // bonus of its own.
  const needsSite = needsSurgicalSite(held.tag);
  const fixedSiteReach = needsSite
    ? await hasEquipmentInReach(prisma, character, SURGICAL_EQUIPMENT_SLUG)
    : false;
  const portablePackReach =
    needsSite && !fixedSiteReach
      ? await hasEquipmentInReach(prisma, character, PORTABLE_SURGICAL_PACK_SLUG)
      : false;
  if (needsSite && !fixedSiteReach && !portablePackReach) {
    throw new UserError(
      "You need surgical equipment to proceed.",
    );
  }
  // The die penalty only ever applies to a surgery Gambit resting on the
  // portable pack alone — a non-site-gated Gambit (reaching above your tier
  // on an ordinary cure) never touches either kit, and a fixed site or
  // Theater in reach cancels the penalty outright, pack or no pack.
  const surgicalPenalty = gambit && needsSite && !fixedSiteReach && portablePackReach;

  const openTurn = await getOpenTurn();

  // The medical Move budget (M2, docs/systemdocs/CRAFTING.md §2a /
  // TAGS.md §5c): a routine cure joins the same craft-budget arithmetic
  // crafting uses. Family is hardcoded "medical" and passed as an override —
  // never derived via craftFamily, which would drop a skill-less cure like
  // choking into the generic `craft` family. Returns null for a free cure:
  // no turn open at all (the pre-M2 posture — no turn, no Move economy,
  // nothing to bill and nothing rationed), or a 0-turn cure still inside the
  // day's shared MEDICAL_SIMPLE_PER_TURN pool. A turns-costing cure is never
  // free; the old per-tier daily case cap it used to be checked against is
  // gone, replaced entirely by the Move fraction.
  //
  // Priced twice, like every other budget craft: here for a fast fail, and
  // again inside the transaction under the row lock, since two simultaneous
  // heals would otherwise both read the same pool count and pass.
  const priceHeal = async (db) => {
    if (!openTurn) return null;
    if (countsAgainstHealCap(held.tag, gambit)) {
      const already = await routineHealsThisTurn(db, session.discordUserId, openTurn.id);
      if (already < MEDICAL_SIMPLE_PER_TURN) return null;
      return craftMoveCost(
        { requirementTurns: 1, requirementPerTurn: MEDICAL_SIMPLE_PER_TURN },
        { quantity: 1, family: "medical" },
      );
    }
    return craftMoveCost(held.tag, { quantity: 1, family: "medical" });
  };

  // The player is never billed more than the dialog showed them (review fix,
  // M2 — mirrors craftRequestImpl's acknowledgeBill). Priced here for the
  // fast fail, and AGAIN inside the transaction, where a concurrent heal may
  // have eaten the free pool between the two — the in-tx copy is what
  // actually holds.
  const billedSeen = parseCount(rawBilledSeen, { min: 0, max: 1 }) ?? 0;
  const acknowledgeBill = (moveCost) => {
    if ((moveCost ? 1 : 0) > billedSeen) {
      throw new UserError(
        "Your free allowance changed since this page loaded — reload to see the new cost.",
      );
    }
  };

  let outsideMoveCost = null;
  if (gambit) {
    // A roll costs the Move, and Action's @@unique([characterId, turnId]) is
    // what makes it one gambit heal a turn — no separate check needed.
    await requireFreeMove(character, openTurn);
  } else {
    outsideMoveCost = await priceHeal(prisma);
    acknowledgeBill(outsideMoveCost);
    if (outsideMoveCost) await resolveCraftMove(character, openTurn, outsideMoveCost);
  }

  const payer = await resolveParty(payerKey);
  if (!payer) throw new UserError("Unknown payer.");
  if (!(await canReachParty(character, payer)))
    throw new UserError(outOfReachMessage(payer));

  // Straight off the tag, never off the client.
  const cost = healCost(held.tag);
  if (cost > payer.balance)
    throw new UserError(`${payer.name} only has ${payer.balance} ⬢.`);

  const ledger = {
    actorDiscordUserId: session.discordUserId,
    actorCharacterId: character.id,
    actorName: character.name,
    turnNumber: openTurn?.number ?? null,
    turnPhase: openTurn?.phase ?? null,
    note: null,
  };

  const effect = {
    targetCharacterId: target.id,
    targetName: target.name,
    selfHeal: target.id === character.id,
    tagId: held.tagId,
    tagName: held.tag.name,
    restore: {
      tagId: held.tagId,
      source: held.source,
      expiresTurn: held.expiresTurn,
      quantity: held.quantity ?? 1,
    },
    resourcesSpent: cost,
    payer: { kind: payer.kind, id: payer.id, name: payer.name },
    // A gambit heal is an ATTEMPT: the die is rolled at turn close and the GM
    // applies the outcome from /gm/turns, so nothing has left the patient yet.
    // `pending` is what tells Undo that no tag came off, and it is never
    // cleared — it stays true because it stays TRUE. The request charged a fee
    // and filed a Move, and that is all it ever did; whatever the GM writes
    // afterwards is their own edit, with its own audit row and its own undo.
    gambit,
    pending: gambit,
    surgicalPenalty,
    // What the catalog charged at the time, so a later review sees the
    // price actually quoted rather than today's tags.yaml.
    requirement: {
      turns: held.tag.requirementTurns,
      perTurn: held.tag.requirementPerTurn,
      resources: held.tag.requirementResources,
      gambit: held.tag.requirementGambit,
      skills: held.tag.requirementSkills.map((t) => t.name),
    },
  };

  // Only a routine cure has an aftermath now — a Gambit's outcome, Stitched Up
  // included, is the GM's to write once the die has been read.
  const aftermathSlugs = gambit ? [] : rollTagChain(held.tag.removesInto);

  await prisma.$transaction(async (tx) => {
    // Re-priced under a row lock. Two tabs would otherwise both read the same
    // pool count or ledger and both pass (requestActions.js's Dead Simple cap
    // has the same pair of checks for the same reason). The lock is taken
    // here rather than left to spendCraftMove alone, because a heal that
    // re-prices to FREE under lock (the pool had room a moment ago and still
    // does) still needs the lock to hold across that re-read.
    if (!gambit) {
      // Deadlock avoidance (review fix, round 3): the medic and the patient
      // are two different Character rows once this is an administered heal,
      // and this transaction locks both (Move billing here, the patient
      // re-check further down) — lock them in sorted-id order, not
      // medic-then-patient, or two medics treating each other at the same
      // instant lock in opposite orders and deadlock (Postgres surfaces an
      // unresolved cycle as a raw 40P01, not a UserError).
      const lockIds =
        target.id !== character.id ? [character.id, target.id].sort() : [character.id];
      for (const id of lockIds) await lockCharacter(tx, id);

      const moveCost = await priceHeal(tx);
      acknowledgeBill(moveCost);
      if (moveCost) {
        // The fast fail only ran resolveCraftMove — which checks the Move
        // window itself — when the OUTSIDE price already billed. A heal that
        // goes from free to billed only here (the pool filled between the two
        // reads) must re-check the window before writing a ledger, the same
        // race craftRequestImpl's spill re-check guards (review fix, M2).
        if (!outsideMoveCost) {
          const { locked } = moveWindow(openTurn, { clockFrozen: await clockFrozen(tx) });
          if (locked) throw new UserError("Moves are locked for this turn.");
        }
        await spendCraftMove(tx, {
          character,
          openTurn,
          need: moveCost,
          entry: craftLedgerEntry(held.tag, moveCost),
        });
      }
    }

    await debitResources(tx, payer, cost);

    if (gambit) {
      // The Move that carries the roll. Same shape as a learner's Lesson
      // Gambit (db/lib/lessons.js) — filed CONFIRMED with the die already
      // rolled, left OPEN for the GM, revealed to the player at turn close by
      // the staged push. The patient's tag is untouched: a roll that has not
      // been read cannot have cured anything, and a failed one can leave them
      // worse (docs/systemdocs/TAGS.md §5c).
      // requireFreeMove() ran above, but the P2002 catch is what actually
      // holds — @@unique([characterId, turnId]) is the real gate, and two tabs
      // submitting at once get past a check that read the table a moment ago.
      // It is also what rations gambit heals to one a turn without a second
      // count. Same posture as fileAutoRoutine().
      let action;
      try {
        // Lucky or Inspired keeps the better of two dice (db/lib/advantage.js);
        // Inspired is spent the instant it wins one.
        const healGambitAdvantage = rollWithAdvantage(character.tags, 6, { gambitOnly: true });
        await consumeInspiredIfUsed(tx, character.id, healGambitAdvantage.source);
        action = await tx.action.create({
          data: {
            characterId: character.id,
            turnId: openTurn.id,
            type: "MOVE",
            status: "CONFIRMED",
            confirmedAt: new Date(),
            moveKind: "GAMBIT",
            moveReviewStatus: "OPEN",
            description: `Treating ${target.id === character.id ? "their own" : `${target.name}'s`} ${held.tag.name}.`,
            diceRoll: healGambitAdvantage.die,
            diceModifier:
              gambitModifierTotal(character.tags, {
                hungerStreak: character.hungerStreak,
                mood: character.mood,
              }) + (surgicalPenalty ? -1 : 0),
            zoneId: character.zoneId ?? null,
            gmNotes: "auto:heal_gambit",
          },
        });
      } catch (err) {
        if (err?.code === "P2002")
          throw new UserError("You've already used your Move this turn.");
        throw err;
      }
      effect.actionId = action.id;
    } else {
      // Patient-side race (review fix, M2): two medics treating the same
      // wound in the same instant both pass the outside gates, both bill ⬢
      // and a Move fraction, and dropCharacterTag on an already-gone row is
      // a silent no-op — the loser would look successful and cure nothing.
      // The TARGET row is already locked (self-heal's own row, via the
      // sorted-order lock above); re-read the held row under that lock.
      // Whoever loses the race gets a clean refusal instead of a phantom
      // success, and the whole transaction — the ⬢ and the Move it already
      // claimed included — rolls back with it.
      const heldNow = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: target.id, tagId: held.tagId } },
      });
      if (!heldNow) {
        throw new UserError(
          `${target.id === character.id ? "You've" : `${target.name} has`} already been treated for that.`,
        );
      }
      effect.restore = {
        tagId: held.tagId,
        source: heldNow.source,
        expiresTurn: heldNow.expiresTurn,
        quantity: heldNow.quantity ?? 1,
      };
      await dropCharacterTag(tx, target.id, held.tagId);
      effect.granted = await grantTagSlugs(
        tx,
        target.id,
        aftermathSlugs,
        openTurn?.number ?? null,
      );
      // Being treated gives back half of what the wound cost the mood
      // (MOOD.md) — woundMoodFor is signed, hence the minus.
      // Only a routine cure — a gambit heal leaves the affliction on them. The
      // held row's tag was loaded without its group, which the rung needs, so
      // it is re-read here rather than trusted.
      const woundTag = await tx.tag.findUnique({
        where: { id: held.tagId },
        select: {
          slug: true,
          requirementResources: true,
          requirementTurns: true,
          requirementPerTurn: true,
          requirementGambit: true,
          group: { select: { slug: true } },
        },
      });
      const relief = -woundMoodFor(woundTag) / 2;
      if (relief > 0) await applyMood(tx, target.id, { kind: "HEALED", base: relief });
    }

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_heal_character",
      targetCharacterId: target.id,
      turnId: openTurn?.id ?? null,
      details: effect,
    });
  });

  await afterInventoryChange([
    target.id,
    payer.kind === "character" ? payer.id : null,
  ]);
  if (target.id !== character.id) {
    notifyCharacter(
      target,
      gambit
        ? `${character.name} is working on your ${held.tag.name}. You'll know how it went at the end of the turn.`
        : `Your ${held.tag.name} was treated.`,
    );
  }
  if (payer.kind === "character" && payer.id !== character.id && cost > 0) {
    notifyCharacter(
      payer,
      `${character.name} paid ${cost} ⬢ from your purse to treat ${target.id === character.id ? "themselves" : target.name}.`,
    );
  }
  revalidateAll();
  return {
    targetName: target.name,
    tagName: held.tag.name,
    cost,
    gambit,
  };
}

