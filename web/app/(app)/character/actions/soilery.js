"use server";

// The Farms placeholder's Sow button (db/lib/soilery.js — read its header first, it's the whole
// rulebook this action enforces). Modeled on extractGodfleshRequestImpl (./misc.js) — the closest
// existing analog: a Location-attribute-gated action with its own refusal chain, filed as a Move
// that commits now and resolves its dice at push (db/lib/moveEffects.js's `farmed` entry).
import { prisma } from "@lifeweb/db";
import { UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { hasAttribute, SOILERY_ATTRIBUTE } from "@lifeweb/db/lib/locationAttributes";
import { sowableCrops, validatePlan, farmRefusalFor, FARM_MAX_CROPS } from "@lifeweb/db/lib/soilery";
import { requireFreeMove, fileAutoRoutine } from "@/lib/moveSpend";
import { logAudit } from "@/lib/requests";
import { dropCharacterTag } from "@/lib/tagEffects";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { requireCharacter, revalidateAll, lockCharacter } from "./shared.js";

// `lines` is the client's plan: [{ crop, planted }, ...] — the same shape db/lib/soilery.js's
// validatePlan checks. It's advisory only; every gate here re-runs server-side against what the
// character actually holds right now, same posture as every other request in this directory.
export async function farmRequestImpl({ lines }) {
  const { session, character } = await requireCharacter();

  const location = character.locationId
    ? await prisma.location.findUnique({
        where: { id: character.locationId },
        select: { id: true, name: true, attributes: true },
      })
    : null;
  if (!hasAttribute(location, SOILERY_ATTRIBUTE)) {
    throw new UserError("There's nothing to sow here.");
  }

  // The farming skill and the Exhausted/Tired lockout (Context §2 of the Soilery plan) — reads the
  // SAME function the Farm button's own tooltip will read (§B8), so the refusal text on the sheet
  // and the one a bypassed request hits can never drift apart.
  const refusal = farmRefusalFor(character.tags, false);
  if (refusal) throw new UserError(refusal);

  // Bound, Dying, Paralyzed, Catatonic — mirrors extractGodfleshRequestImpl's gate (misc.js).
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) {
    throw new UserError(`You're in no state to work a field — you're ${blocker.name}.`);
  }

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);

  // Read once and reuse for both checks below — a GM's cap edit landing a
  // moment after this request started is no different from any other
  // GameConfig edit taking effect "on the next request" (no cache anywhere
  // in this system), so there's no correctness reason to re-read it inside
  // the transaction.
  const gameConfig = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { farmMaxCrops: true },
  });
  const maxCrops = gameConfig?.farmMaxCrops ?? FARM_MAX_CROPS;

  const licensed = sowableCrops(character.tags);
  const { ok, error } = validatePlan(lines, licensed, maxCrops);
  if (!ok) throw new UserError(error);

  const cropSlugs = [...new Set((lines ?? []).map((row) => row?.crop))];
  const cropTags = await prisma.tag.findMany({
    where: { slug: { in: cropSlugs } },
    select: { id: true, slug: true, name: true },
  });
  const tagBySlug = new Map(cropTags.map((tag) => [tag.slug, tag]));
  for (const row of lines) {
    if (!tagBySlug.has(row.crop)) {
      throw new UserError(`The catalog has no "${row.crop}" tag. Tell a GM.`);
    }
  }

  const farmPlan = {
    v: 1,
    rows: lines.map((row) => {
      const tag = tagBySlug.get(row.crop);
      return { slug: row.crop, tagId: tag.id, tagName: tag.name, planted: row.planted };
    }),
  };
  const description = `Sowing the fields: ${farmPlan.rows
    .map((row) => `${row.planted} ${row.tagName}`)
    .join(", ")}.`;

  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);

    // Re-check the sowing licences UNDER the lock — two tabs opening the same seed bag can't both
    // spend its one ticket (the plan's own concurrency requirement for this step).
    const sowingSlugs = licensed.map((entry) => entry.sowing);
    const held = await tx.characterTag.findMany({
      where: { characterId: character.id, tag: { slug: { in: sowingSlugs } } },
      select: { tagId: true, tag: { select: { slug: true } } },
    });
    const heldAsCharacterTags = held.map((row) => ({ tag: { slug: row.tag.slug } }));
    const stillLicensed = sowableCrops(heldAsCharacterTags);
    const recheck = validatePlan(lines, stillLicensed, maxCrops);
    if (!recheck.ok) throw new UserError(recheck.error);

    // One bag licenses any amount of that crop — spend the ticket once per crop USED, not once
    // per unit planted.
    const sowingSlugByCrop = new Map(licensed.map((entry) => [entry.crop, entry.sowing]));
    const ticketTagIdBySlug = new Map(held.map((row) => [row.tag.slug, row.tagId]));
    const usedSowingSlugs = new Set(lines.map((row) => sowingSlugByCrop.get(row.crop)));
    for (const sowingSlug of usedSowingSlugs) {
      const ticketTagId = ticketTagIdBySlug.get(sowingSlug);
      if (ticketTagId) await dropCharacterTag(tx, character.id, ticketTagId, 1);
    }

    // Commits now — the seed is spent — but defers the wither die and the Exhausted lockout to
    // the turn push (db/lib/moveEffects.js's `farmed` entry), exactly like `refined`.
    const action = await fileAutoRoutine(tx, character, openTurn, description, "auto:farm", null, {
      deferEffects: true,
      farmPlan,
    });

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_farm",
      targetCharacterId: character.id,
      turnId: openTurn.id,
      details: { farmPlan, locationName: location?.name ?? null, actionId: action.id },
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();

  return {
    line: "You sowed the fields. The harvest comes in when the turn closes.",
  };
}
