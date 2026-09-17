// Healing a character, and the per-turn heal-routine counter it shares
// only with itself.

import { prisma } from "@lifeweb/db";
import { getOpenTurn } from "@/lib/turn";
import {
  logAudit,
  craftAllowance,
  unitsOfTagThisTurn,
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
  isMiracleable,
  MIRACLE_PER_TURN,
  needsSurgicalSite,
  SAINT_SLUG,
  satisfiedSkillIds,
} from "@/lib/healRequests";
import {
  canReachParty,
  outOfReachMessage,
} from "@/lib/transferReach";
import { concealedNow } from "@lifeweb/db/lib/presence";
import { medicallyVisibleTags } from "@lifeweb/db/lib/medicalVision";
import { resolveHereTarget } from "@/lib/hereTarget";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
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
import { movesOpen } from "@lifeweb/db/lib/turnGate";
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

// The two per-turn craft counters live in web/lib/requests.js beside
// `craftAllowance`, since character/page.js reads the same numbers for the Craft dialog.

// 0-turn cures already worked this turn, against MEDICAL_SIMPLE_PER_TURN
// (M2, TAGS.md §5c) — the shared free-first-aid pool. Counts REQUESTS, not
// units, and only ones costing NO turn of work — a turns-costing cure bills
// the medical family's Move instead (healCharacterRequestImpl below); a
// gambit heal is never in here, rationed by the Action unique constraint.
// Keyed on the MEDIC, not targetCharacterId — counting the patient's axis
// caps the wrong person.
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
// here (web/lib/peopleHere.js), and the affliction's requirementSkills are
// satisfied. The PAYER is ungated beyond being here, same bet as Craft.
export async function healCharacterRequestImpl({
  targetCharacterId,
  tagId,
  payerKey,
  // Mirrors craftRequestImpl's billedSeen contract (CRAFTING.md §2a): 1 if
  // the dialog showed this as costing the Move, 0 if free. Never bills more
  // than the dialog acknowledged — a stale reading gets "reload" instead (review fix, M2).
  billedSeen: rawBilledSeen,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId) {
    throw new UserError("You aren't anywhere you could treat someone.");
  }

  // Flat catalog, so a higher tier still satisfies a requirement written against the base skill.
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
    throw new UserError("You need Medical I to treat anyone.");
  }

  // No exclusion of self — treating yourself is the ordinary case, and
  // resolveHereTarget lets a key naming you through for exactly that reason.
  //
  // The key is a target key now, not a bare id: "character:<id>" for somebody
  // standing in the open and "hood:<token>" for somebody in a mask. A hood
  // hides WHO you are, never THAT you are bleeding in front of a doctor, and
  // until this a closed helmet made a person unhealable by anybody.
  const target = await resolveHereTarget(character, targetCharacterId, {
    status: "ALIVE",
    select: {
      id: true,
      name: true,
      concealed: true,
      locationId: true,
      status: true,
      buriedAt: true,
      discordUserId: true,
      tags: { include: { tag: { include: { requirementSkills: true } } } },
    },
  });

  const held = target.tags.find((ct) => ct.tagId === tagId);
  if (!held || !isHealable(held.tag))
    throw new UserError("That isn't something you can treat.");
  // The picker narrows a HOODED patient's wound list to what this medic could
  // actually see (web/lib/peoplePools.js), and the picker is a hint, never the
  // lock — so the same predicate runs again here. Without it, posting any tag
  // id would treat, and confirm, an affliction the mask was hiding.
  if (concealedNow(target) && target.id !== character.id) {
    const visible = medicallyVisibleTags(target.tags, satisfied, false);
    if (!visible.some((row) => row.characterTag.tagId === held.tagId))
      throw new UserError("That isn't something you can treat.");
  }

  // Above your tier, or the top rung, is a GAMBIT rather than a refusal
  // (TAGS.md §5c) — nothing is out of reach, only whether you roll for it.
  const gambit = isGambitHeal(held.tag, satisfied);
  // Surgery needs a site (M3, TAGS.md §5c; reworked M6b): a tier-6/7 cure
  // refuses outright without something enabling it — the fixed Surgical
  // Equipment kit (or a COMPLETE Surgical Theater, same reach path as a
  // Forge satisfying Workshop Equipment), or, failing that, a Portable
  // Surgical Pack. Neither is consumed. NOT equivalent: a real site carries
  // no penalty; the portable pack alone rolls the Gambit at −1, and a fixed site/Theater always erases that penalty.
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
  // The die penalty only applies to a surgery Gambit resting on the portable
  // pack alone; a fixed site or Theater in reach always cancels it.
  const surgicalPenalty = gambit && needsSite && !fixedSiteReach && portablePackReach;

  const openTurn = await getOpenTurn();

  // The medical Move budget (M2, CRAFTING.md §2a / TAGS.md §5c): a routine
  // cure joins the same craft-budget arithmetic crafting uses. Family is
  // hardcoded "medical", never derived via craftFamily (which would drop a
  // skill-less cure like choking into the generic `craft` family). Returns
  // null for a free cure: no turn open, or still inside the shared
  // MEDICAL_SIMPLE_PER_TURN pool. Priced twice, like every budget craft: here
  // for a fast fail, and again under the row lock, since two simultaneous heals could otherwise both pass.
  const priceHeal = async (db) => {
    if (!openTurn) return null;
    if (countsAgainstHealCap(held.tag, gambit)) {
      const already = await routineHealsThisTurn(db, session.discordUserId, openTurn.id);
      if (already < MEDICAL_SIMPLE_PER_TURN) return null;
      return craftMoveCost(
        // A quarter of a Move, the Simple rung's own cost — what a cure past
        // the medic's free pool bills. MEDICAL_SIMPLE_PER_TURN is the SIZE of
        // that pool; the two happen to agree at four a turn.
        { requirementTurns: 1 / MEDICAL_SIMPLE_PER_TURN },
        { quantity: 1, family: "medical" },
      );
    }
    return craftMoveCost(held.tag, { quantity: 1, family: "medical" });
  };

  // Never billed more than the dialog showed (review fix, M2 — mirrors
  // craftRequestImpl's acknowledgeBill). Priced again inside the transaction, which is what actually holds.
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
    // A roll costs the Move; Action's @@unique([characterId, turnId]) makes it one gambit heal a turn.
    await requireFreeMove(character, openTurn);
  } else {
    outsideMoveCost = await priceHeal(prisma);
    acknowledgeBill(outsideMoveCost);
    if (outsideMoveCost) await resolveCraftMove(character, openTurn, outsideMoveCost);
  }

  // allowConcealed, because a hood is a person standing right there who can
  // hand over coins: resolveParty has already re-verified co-presence for a
  // token, and refusing here would only mean a masked friend cannot pay for
  // your cure. outOfReachMessage prints a name, so a hood that somehow got this
  // far is refused in the blank form instead (web/lib/hereTarget.js#refusalFor).
  const payer = await resolveParty(payerKey, { actor: character });
  if (!payer) throw new UserError("Unknown payer.");
  if (!(await canReachParty(character, payer, { allowConcealed: true })))
    throw new UserError(payer.concealed ? "They aren't here." : outOfReachMessage(payer));

  // Straight off the tag, never off the client.
  const cost = healCost(held.tag);
  if (cost > payer.balance)
    throw new UserError(`${payer.name} only has ${payer.balance} ⬢.`);

  const ledger = {
    actorDiscordUserId: session.discordUserId,
    actorCharacterId: character.id,
    actorName: character.name,
    turnNumber: openTurn?.number ?? null,
    dayNumber: openTurn?.dayNumber ?? null,
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
    // A gambit heal is an ATTEMPT — die rolled at turn close, GM applies the
    // outcome from /gm/turns, nothing has left the patient yet. `pending`
    // tells Undo no tag came off, and it stays TRUE forever — the request
    // only charged a fee and filed a Move; whatever the GM writes later is their own edit.
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
    // Re-priced under a row lock — two tabs would otherwise both read the
    // same pool count and pass (requestActions.js's Dead Simple cap does the same pair of checks).
    if (!gambit) {
      // Deadlock avoidance (review fix, round 3): this transaction locks
      // both the medic and patient rows, so lock in sorted-id order — not
      // medic-then-patient — or two medics treating each other lock in
      // opposite orders and deadlock (Postgres surfaces this as a raw 40P01, not a UserError).
      const lockIds =
        target.id !== character.id ? [character.id, target.id].sort() : [character.id];
      for (const id of lockIds) await lockCharacter(tx, id);

      const moveCost = await priceHeal(tx);
      acknowledgeBill(moveCost);
      if (moveCost) {
        // A heal that goes from free to billed only here (pool filled
        // between reads) must re-check the window, the same race craftRequestImpl's spill re-check guards (review fix, M2).
        if (!outsideMoveCost) {
          const gate = await movesOpen(tx, { turn: openTurn });
          if (!gate.ok) throw new UserError(gate.message);
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
      // Same shape as a learner's Lesson Gambit (db/lib/lessons.js) — filed
      // CONFIRMED with the die already rolled, revealed at turn close by the
      // staged push. Patient's tag untouched: an unread roll can't have
      // cured anything, and a failed one can leave them worse (TAGS.md §5c).
      // requireFreeMove() ran above, but the P2002 catch is what actually
      // holds — @@unique([characterId, turnId]) rations two racing tabs to one gambit heal a turn.
      let action;
      try {
        // Lucky or Inspired keeps the better of two dice; Inspired spends the instant it wins one.
        const healGambitAdvantage = rollWithAdvantage(character.tags, 6);
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
              gambitModifierTotal(character.tags, { mood: character.mood }) + (surgicalPenalty ? -1 : 0),
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
      // Patient-side race (review fix, M2): dropCharacterTag on an
      // already-gone row is a silent no-op, so the target row (already
      // locked via the sorted-order lock above) is re-read under that lock —
      // the loser gets a clean refusal and the whole transaction rolls back.
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
      // (MOOD.md) — woundMoodFor is signed, hence the minus. The held row's
      // tag was loaded without its group, which the rung needs, so re-read here.
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

// --- Perform Miracle -------------------------------------------------
// Saint's free instant cure (docs/tags.yaml `saint:`): twice a turn, on
// somebody else's Moderate-or-lesser wound. No ⬢, no Move, no Medical
// training. Own AuditLog count — never touches MEDICAL_SIMPLE_PER_TURN.

async function miraclesThisTurn(db, discordUserId, turnId) {
  if (!turnId || !discordUserId) return 0;
  return db.auditLog.count({
    where: {
      actorDiscordUserId: discordUserId,
      actionType: "request_perform_miracle",
      turnId,
    },
  });
}

export async function performMiracleRequestImpl({ targetCharacterId, tagId }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
  if (!heldSlugs.has(SAINT_SLUG)) {
    throw new UserError("Only a Saint may perform a miracle.");
  }
  if (!character.locationId) {
    throw new UserError("You aren't anywhere you could touch anyone.");
  }

  // A hood is a body you can lay hands on, so this takes a target key like the
  // rest (db/lib/targetKey.js). The self check moved BELOW the resolve: a key
  // naming you is "character:<id>", not a bare id, and comparing the raw string
  // would have quietly stopped catching it.
  const target = await resolveHereTarget(character, targetCharacterId, {
    status: "ALIVE",
    select: {
      id: true,
      name: true,
      concealed: true,
      locationId: true,
      status: true,
      buriedAt: true,
      discordUserId: true,
      tags: { include: { tag: true } },
    },
  });
  if (target.id === character.id) {
    throw new UserError("A Saint doesn't perform miracles on themselves.");
  }

  const held = target.tags.find((ct) => ct.tagId === tagId);
  if (!held || !isMiracleable(held.tag)) {
    throw new UserError("That isn't a wound a miracle could touch.");
  }
  // On a masked subject, only a wound the room can plainly see. An empty
  // `satisfied` set is the point rather than an oversight: sainthood is not a
  // medical training, so the doctor's-eye exception inside medicallyVisibleTags
  // buys a Saint nothing and this reduces to the bystander read.
  if (concealedNow(target) && !medicallyVisibleTags(target.tags, new Set(), false)
      .some((row) => row.characterTag.tagId === held.tagId)) {
    throw new UserError("That isn't a wound a miracle could touch.");
  }

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  // Fast fail before the transaction — the row-locked re-count below is what
  // actually holds under a race.
  if ((await miraclesThisTurn(prisma, session.discordUserId, openTurn.id)) >= MIRACLE_PER_TURN) {
    throw new UserError("You've used both miracles this turn.");
  }

  const effect = {
    targetCharacterId: target.id,
    targetName: target.name,
    tagId: held.tagId,
    tagSlug: held.tag.slug,
    tagName: held.tag.name,
  };

  await prisma.$transaction(async (tx) => {
    // Sorted-id lock — same deadlock avoidance the heal action uses when two
    // Saints in one Room miracle each other's neighbours.
    const lockIds = [character.id, target.id].sort();
    for (const id of lockIds) await lockCharacter(tx, id);

    if ((await miraclesThisTurn(tx, session.discordUserId, openTurn.id)) >= MIRACLE_PER_TURN) {
      throw new UserError("You've used both miracles this turn.");
    }

    const heldNow = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId: target.id, tagId: held.tagId } },
    });
    if (!heldNow) {
      throw new UserError(`${target.name} no longer has that.`);
    }

    await dropCharacterTag(tx, target.id, held.tagId);

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_perform_miracle",
      targetCharacterId: target.id,
      turnId: openTurn.id,
      details: effect,
    });
  });

  await afterInventoryChange([target.id]);
  notifyCharacter(target, `${character.name} healed your ${held.tag.name} with a miracle.`);
  revalidateAll();
  return { targetName: target.name, tagName: held.tag.name, name: target.name };
}
