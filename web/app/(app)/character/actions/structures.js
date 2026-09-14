// Build sites: open, join, cancel. See CRAFTING.md (`Tag.placement`) and
// db/lib/structures.js.

import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { UserError } from "@/lib/actionResult";
import {
  requireFreeMove,
  fileAutoRoutine,
} from "@/lib/moveSpend";
import { moveResources } from "@/lib/tagEffects";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import {
  INSCRIPTION_MAX,
  cleanCustomText,
} from "@/lib/customCraft";
import {
  placementOf,
  structuresAt,
  canBuildHere,
  PRESENT_STATUSES,
  siteOpenedLine,
  siteAdvancedLine,
  siteCompletedLine,
  siteCancelledLine,
  stakeholderCharacterIds,
} from "@lifeweb/db/lib/structures";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { notifyCharacter } from "@/lib/notifyCharacter";
import {
  requireCharacter,
  revalidateAll,
  loadBuildGround,
  speakAtSite,
} from "./shared.js";
import { resolveCraftPayer, payerNotice } from "./crafting.js";

// --- Building (db/lib/structures.js) ----------------------------------
//
// A craftable whose Tag.placement is non-null is raised ON SITE instead of
// landing in a pocket. Costs are CREW-TURNS: `turnsCost` is the total number
// of person-turns, and anyone standing at the site can spend their daily Move
// advancing it. The recipe's skills gate OPENING a site, never joining one —
// a mason lays out the work, the labour is anybody's. The opener pays the
// whole resourceCost up front and never gets it back, the CraftProject rule.


// A structure has no owner, but everyone whose turns raised it hears when it
// changes state. db/lib/structures.js returns characterIds only, so the DM
// addresses are looked up here.
async function notifyStakeholders(
  structureId,
  { except = null, payerKey = null },
  text,
) {
  const ids = await stakeholderCharacterIds(prisma, structureId, {
    except,
    payerKey,
  });
  if (!ids.length) return;
  const people = await prisma.character.findMany({
    where: { id: { in: ids }, status: "ALIVE" },
    select: { id: true, discordUserId: true },
  });
  for (const person of people) notifyCharacter(person, text);
}

// The finish, recorded inside the SAME transaction that claimed the last
// crew-turn. The claim is the caller's conditional updateMany — nothing here
// may re-read status to decide, or there would be two winners.
async function finishStructure(
  tx,
  { session, character, site, location, openTurn, action },
) {
  const contributors = await tx.structureWork.findMany({
    where: { structureId: site.id },
    select: { characterId: true, characterName: true },
  });
  const payerParts = String(site.payerKey ?? "").split(":");
  const payer = {
    kind: payerParts[0] || "character",
    id: payerParts[1] || null,
    name: site.payerName ?? null,
  };
  const effect = {
    structureId: site.id,
    typeSlug: site.typeSlug,
    typeName: site.typeName,
    locationId: site.locationId,
    locationName: location?.name ?? null,
    turnsNeeded: site.turnsNeeded,
    resourcesSpent: site.resourcesCost ?? 0,
    payer,
    contributors: contributors.map((w) => ({
      characterId: w.characterId,
      name: w.characterName,
    })),
    builderName: site.builderName ?? null,
    actionId: action?.id ?? null,
  };
  await logAudit(tx, {
    actorDiscordUserId: session.discordUserId,
    actionType: "build_completed",
    targetCharacterId: character.id,
    details: {
      structureId: site.id,
      typeSlug: site.typeSlug,
      typeName: site.typeName,
      locationId: site.locationId,
      turnsNeeded: site.turnsNeeded,
      resourcesSpent: site.resourcesCost ?? 0,
      payer,
      actionId: action?.id ?? null,
    },
  });
}

// The one-per-place rule. The wreck statuses (RUINED, ABANDONED) are
// deliberately absent from the list: clearing a wreck and raising a new one
// on the same ground is what they are for. Runs twice per open, the Dead
// Simple pattern: once before the transaction for a fast fail, and again
// inside it under the Location row lock, since two tabs would otherwise
// both read the same ground and both pass.
async function refuseSameTypeHere(db, location, tag, placement) {
  const standing = await structuresAt(db, location.id, {
    statuses: PRESENT_STATUSES,
  });
  const sameType = standing.filter((s) => s.typeSlug === tag.slug);
  if (sameType.some((s) => s.status === "UNDER_CONSTRUCTION")) {
    throw new UserError(
      `A ${tag.name} is already going up here — lend a hand to that one instead.`,
    );
  }
  if (placement.unique && sameType.length) {
    throw new UserError(`There is already a ${tag.name} here.`);
  }
}

// Opening a site: the gates the recipe carries have already run in
// craftRequestImpl. What is left is the GROUND, the one-per-place rule, and
// the charge.
export async function openBuildSiteImpl(
  character,
  session,
  tag,
  { payerKey, inscription },
) {
  const placement = placementOf(tag);
  // The builder's line, only where the type invites one (the wayside
  // shrine's placement.inscribable). Cleaned by the shared helper — no rich
  // tokens, no @ — and it prints in Examine in place of the stock
  // examine fragment (db/lib/locationAttributes.js#structureLines).
  const inscribed = placement?.inscribable
    ? cleanCustomText(inscription, INSCRIPTION_MAX)
    : "";
  const location = await loadBuildGround(character.locationId);
  const ground = canBuildHere(location, placement);
  if (!ground.ok) throw new UserError(ground.reason);

  await refuseSameTypeHere(prisma, location, tag, placement);

  // Always one. A structure is a place, not a stack.
  const cost = tag.requirementResources ?? 0;
  const turns = tag.requirementTurns ?? 1;
  const payer = await resolveCraftPayer(character, payerKey, cost);
  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);

  const done = turns <= 1;
  let structureId = null;
  await prisma.$transaction(async (tx) => {
    // The ground was judged outside this transaction, so two tabs can both
    // have passed. The Location row is the lock — every open here serialises
    // on it — and the re-check against tx sees whatever the winner committed.
    await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "id" = ${location.id} FOR UPDATE`;
    await refuseSameTypeHere(tx, location, tag, placement);
    if (cost) await moveResources(tx, payer, -cost);
    // A one-turn build is born finished: the row is created inside this
    // transaction, so nobody else can be racing for its completion and the
    // conditional claim join uses would have nothing to guard.
    const site = await tx.structure.create({
      data: {
        locationId: location.id,
        typeSlug: tag.slug,
        typeName: tag.name,
        status: done ? "COMPLETE" : "UNDER_CONSTRUCTION",
        turnsNeeded: turns,
        turnsDone: 1,
        resourcesCost: cost,
        payerKey: `${payer.kind}:${payer.id}`,
        payerName: payer.name,
        builderCharacterId: character.id,
        builderName: character.name,
        startedTurnId: openTurn.id,
        inscription: inscribed || null,
      },
    });
    structureId = site.id;
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      done
        ? `Raised a ${tag.name}.`
        : `Raising a ${tag.name} (1/${turns}).`,
      "auto:build",
    );
    await tx.structureWork.create({
      data: {
        structureId: site.id,
        characterId: character.id,
        characterName: character.name,
        turnId: openTurn.id,
        actionId: action.id,
      },
    });
    if (done) {
      await finishStructure(tx, {
        session,
        character,
        site,
        location,
        openTurn,
        action,
      });
    } else {
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "build_started",
        targetCharacterId: character.id,
        details: {
          structureId: site.id,
          tagId: tag.id,
          tagName: tag.name,
          turnsNeeded: turns,
          resourcesCost: cost,
          payer: { kind: payer.kind, id: payer.id, name: payer.name },
          actionId: action.id,
        },
      });
    }
  });

  await afterInventoryChange([
    character.id,
    payer.kind === "character" ? payer.id : null,
  ]);
  payerNotice(character, payer, cost, tag);
  const spoken = { typeName: tag.name, turnsNeeded: turns };
  speakAtSite(
    location.discordChannelId,
    done ? siteCompletedLine(spoken) : siteOpenedLine(spoken),
  );
  if (done) {
    await notifyStakeholders(
      structureId,
      { except: character.id, payerKey: `${payer.kind}:${payer.id}` },
      `The ${tag.name} at ${location.name} stands finished.`,
    );
  }
  revalidateAll();
  // The craft return shape, since the same dialog files both.
  return done ? { made: tag.name } : { started: tag.name, turns };
}

// Another crew-turn on somebody's site. No skill check and no payer: the
// recipe gated the opening, and the ⬢ were all spent then.
export async function joinBuildSiteImpl({ structureId }) {
  const { session, character } = await requireCharacter();

  // Read fresh, and matched against the character's OWN locationId rather
  // than anything posted — a server action is a public endpoint.
  const site = await prisma.structure.findFirst({
    where: {
      id: structureId ?? "",
      status: "UNDER_CONSTRUCTION",
      locationId: character.locationId ?? "",
    },
  });
  if (!site) throw new UserError("That site isn't here.");

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);
  const location = await prisma.location.findUnique({
    where: { id: site.locationId },
    select: { name: true, discordChannelId: true },
  });

  const next = site.turnsDone + 1;
  const done = next >= site.turnsNeeded;

  await prisma.$transaction(async (tx) => {
    let work;
    try {
      work = await tx.structureWork.create({
        data: {
          structureId: site.id,
          characterId: character.id,
          characterName: character.name,
          turnId: openTurn.id,
        },
      });
    } catch (err) {
      if (err?.code === "P2002")
        throw new UserError("You've already worked on that this turn.");
      throw err;
    }
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      done
        ? `Raised a ${site.typeName}.`
        : `Raising a ${site.typeName} (${next}/${site.turnsNeeded}).`,
      "auto:build",
    );
    await tx.structureWork.update({
      where: { id: work.id },
      data: { actionId: action.id },
    });
    // The check IS the write. One conditional statement carries the advance
    // AND, on the last crew-turn, the completion, so two same-tick finishers
    // cannot both claim it.
    const claim = await tx.structure.updateMany({
      where: {
        id: site.id,
        status: "UNDER_CONSTRUCTION",
        turnsDone: site.turnsDone,
      },
      data: done
        ? { turnsDone: next, status: "COMPLETE" }
        : { turnsDone: next },
    });
    if (claim.count === 0)
      throw new UserError("The work moved on without you — reload.");
    if (done) {
      await finishStructure(tx, {
        session,
        character,
        site: { ...site, turnsDone: next },
        location,
        openTurn,
        action,
      });
    } else {
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "build_continued",
        targetCharacterId: character.id,
        details: {
          structureId: site.id,
          typeSlug: site.typeSlug,
          typeName: site.typeName,
          turnsDone: next,
          turnsNeeded: site.turnsNeeded,
          actionId: action.id,
        },
      });
    }
  });

  // No afterInventoryChange: nothing on any sheet moved. A join spends a Move
  // and nothing else, and finishing moves nothing either — a structure is
  // never a CharacterTag, and the ⬢ left the payer when the site opened.
  speakAtSite(
    location?.discordChannelId,
    done ? siteCompletedLine(site) : siteAdvancedLine(site, next),
  );
  if (done) {
    await notifyStakeholders(
      site.id,
      { except: character.id, payerKey: site.payerKey },
      `The ${site.typeName} at ${location?.name ?? "the site"} stands finished.`,
    );
  }
  revalidateAll();
  return done
    ? { made: site.typeName }
    : { continued: site.typeName, turnsDone: next, turns: site.turnsNeeded };
}

// Calling it off. The opener's alone to call, from anywhere — a builder who
// walked away can still abandon their own site — and it keeps nothing: the ⬢
// went into materials when the work began, cancelCraftImpl's rule.
//
// The plan says "opener or GM"; the GM half is deliberately not here. It
// arrives with milestone C's Damage/Destroy surface, which subsumes it — a
// GM pulling a site down is the same desk action as pulling a wall down.
export async function cancelBuildSiteImpl({ structureId }) {
  const { session, character } = await requireCharacter();

  const site = await prisma.structure.findFirst({
    where: {
      id: structureId ?? "",
      status: "UNDER_CONSTRUCTION",
      builderCharacterId: character.id,
    },
  });
  if (!site)
    throw new UserError("That isn't your site, or the work is already over.");
  const location = await prisma.location.findUnique({
    where: { id: site.locationId },
    select: { name: true, discordChannelId: true },
  });

  await prisma.$transaction(async (tx) => {
    // The status flip is the claim: a site somebody finished a moment ago
    // must not be pulled down out from under them. ABANDONED, not RUINED —
    // walked-away-from groundwork and wreckage something made are different
    // events, and each status wears its own words.
    const claim = await tx.structure.updateMany({
      where: { id: site.id, status: "UNDER_CONSTRUCTION" },
      data: { status: "ABANDONED" },
    });
    if (claim.count === 0)
      throw new UserError("The work moved on without you — reload.");
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "build_cancelled",
      targetCharacterId: character.id,
      details: {
        structureId: site.id,
        typeSlug: site.typeSlug,
        typeName: site.typeName,
        locationId: site.locationId,
        turnsDone: site.turnsDone,
        turnsNeeded: site.turnsNeeded,
        resourcesCost: site.resourcesCost ?? 0,
      },
    });
  });

  speakAtSite(location?.discordChannelId, siteCancelledLine(site));
  await notifyStakeholders(
    site.id,
    { except: character.id, payerKey: site.payerKey },
    `Work on the ${site.typeName} at ${location?.name ?? "the site"} has been called off.`,
  );
  revalidateAll();
  return { cancelled: site.typeName };
}

