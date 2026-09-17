// Craft / continue / cancel a craft project, mint and unmint custom crafts,
// and the ingredient/payer resolution they share. See CRAFTING.md.

import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { getOpenTurn } from "@/lib/turn";
import {
  logAudit,
  craftAllowance,
  unitsOfTagThisTurn,
} from "@/lib/requests";
import {
  WHOLE_MOVE,
  addFractions,
  craftFamilyLabel,
  craftMoveCost,
  fitsInRemaining,
  formatMoveAmount,
  ledgerRemaining,
  ledgerUsed,
} from "@/lib/craftBudget";
import { UserError } from "@/lib/actionResult";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import {
  requireFreeMove,
  fileAutoRoutine,
} from "@/lib/moveSpend";
import {
  addRequirementSatisfied,
  craftFamily,
  moveFamilyOf,
  needsWorkshop,
} from "@/lib/tagRequests";
import {
  tagsById as buildTagsById,
  exclusiveConflict,
  conflictingTag,
  chainSiblingsToRemove,
  heldHigherTiers,
} from "@/lib/characterCreation";
import {
  addToStack,
  dropCharacterTag,
  moveResources,
} from "@/lib/tagEffects";
import {
  buildSkillAncestry,
  satisfiedSkillIds,
} from "@/lib/healRequests";
import {
  canReachParty,
  outOfReachMessage,
} from "@/lib/transferReach";
import { heldSlugsOf } from "@/lib/consumeGrants";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import {
  WORKSHOP_EQUIPMENT_SLUG,
  BREWING_DISTILLING_SLUG,
} from "@lifeweb/db/lib/constants";
import { hasEquipmentInReach } from "@lifeweb/db/lib/equipmentReach";
import {
  mintCustomCraft as dbMintCustomCraft,
  unmintCustomCraft as dbUnmintCustomCraft,
} from "@lifeweb/db/lib/customCraftMint";
import {
  CUSTOM_SURCHARGE,
  cleanCustomText,
  customCraftFields,
  mayCustomize,
  customCraftFor,
} from "@/lib/customCraft";
import { placementOf } from "@lifeweb/db/lib/structures";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { ACT } from "@lifeweb/db/lib/incapacitation";
import { openBuildSiteImpl } from "./structures.js";
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

// --- Craft (docs/systemdocs/CRAFTING.md) ------------------------------

// The recipe, with everything the gates read.
async function loadRecipe(tagId) {
  const tag = await prisma.tag.findUnique({
    where: { id: tagId ?? "" },
    include: {
      group: { select: { requiredTagId: true } },
      requirementSkills: { select: { id: true, slug: true, name: true } },
    },
  });
  // requirementItems rides on the full row `include` gives us (resolveRecipeItems below) — a narrower `select` here would silently disable ingredient checking.
  if (!tag) throw new UserError("Unknown tag.");
  // Re-checked here because the client's filtered list is only advisory.
  if (!tag.craftable)
    throw new UserError("That isn't something you can make.");
  return tag;
}

// Every recipe skill, or a higher tier of it, held by the crafter.
async function requireRecipeSkills(character, tag) {
  if (!tag.requirementSkills.length) return;
  const catalog = await prisma.tag.findMany({
    select: { id: true, slug: true, parentTagId: true },
  });
  const satisfied = satisfiedSkillIds(
    character.tags.map((ct) => ct.tagId),
    buildSkillAncestry(catalog),
  );
  const missing = tag.requirementSkills.filter(
    (skill) => !satisfied.has(skill.id),
  );
  if (missing.length) {
    throw new UserError(
      `Making that needs ${missing.map((t) => t.name).join(" and ")}.`,
    );
  }
}

// Smithing and building need a forge; ordinary crafting needs your hands. Read off the recipe's own skills rather
// than a per-tag flag, so a new sword is gated the moment it names a smithing skill. Reach is "hold it, or stand somewhere one is set up" (db/lib/equipmentReach.js). See docs/systemdocs/SMITHING.md.
async function requireWorkshop(character, tag) {
  if (!needsWorkshop(tag)) return;
  if (await hasEquipmentInReach(prisma, character, WORKSHOP_EQUIPMENT_SLUG))
    return;
  throw new UserError(
    `Making that is smith's work: hold Workshop Equipment, or stand somewhere a set is already put up.`,
  );
}

// Ingredient SLOTS (COOKING.md), alongside `items` not inside it. Runs OUTSIDE the transaction, against your OWN sheet only, once when work STARTS (a project pays up front, a continue re-checks nothing). `ingredientChoices` arrives ALREADY cleaned by the caller — don't re-clean, two copies would drift.
// Membership is "any tag with a `cooked` block", resolved by the caller into `cookableBySlug` — that genericity is what lets trinketActions.js reuse this for the disjoint `inlayValue` pool under the same map name; cooking and Trinket never overlap.
export async function resolveIngredientSlots(character, tag, quantity, ingredientChoices, cookableBySlug) {
  const slots = tag.requirementIngredientSlots;
  const plan = { spend: [], cookedFrom: [] };
  const picks = ingredientChoices ?? [];
  if (!slots) {
    // Picks posted at a recipe with no slots are ignored rather than refused — the same posture quantity takes on a non-stackable.
    return plan;
  }
  if (picks.length < slots.min) {
    throw new UserError(
      slots.min === 1
        ? "That needs ingredients."
        : `That needs ${slots.min} ingredients.`,
    );
  }
  if (picks.length > slots.max) {
    throw new UserError(`That takes at most ${slots.max}.`);
  }
  // No slug twice — keeps "it tastes like onion and onion" off the notice, and keeps the spend honest: two slots naming one stack would draw against it twice and the second refusal would name a count nobody could make sense of.
  if (new Set(picks).size !== picks.length) {
    throw new UserError("You've put the same ingredient in twice.");
  }
  const bySlug = new Map(character.tags.filter((ct) => ct.tag).map((ct) => [ct.tag.slug, ct]));
  for (const slug of picks) {
    if (!cookableBySlug?.has(slug)) {
      throw new UserError("That isn't something you can cook with.");
    }
    const ct = bySlug.get(slug);
    const name = cookableBySlug.get(slug).name;
    if (!ct || ct.quantity < quantity) {
      throw new UserError(
        quantity > 1
          ? `Making ${quantity} of those takes ${quantity} × ${name}. You have ${ct?.quantity ?? 0}.`
          : `Making that needs ${name}.`,
      );
    }
    plan.spend.push({ tagId: ct.tagId, tagName: name, quantity });
    plan.cookedFrom.push(slug);
  }
  return plan;
}

// requirementItems: most entries are SPENT `quantity` per craft (× an entry's own `count` multiplier); `keep` is a
// hold-check instead (a body has its own lifecycle — a second Miasma bottled over the same corpse is still fine); `group` is always kept and is the only way to name a corpse written at death; `anyOf` is a spend the PLAYER picks, and the membership check here is what makes the dialog a hint, not a lock.
// A recipe with several `anyOf` pickers (Vegetable Stew, Fried Fish, Sweets — COOKING.md §A4) is answered by `ingredientPicks[entry.pickerIndex]`; `ingredientChoice` is the single-picker channel every recipe used before multi-picker existed (plus the Death Mask's corpse pick, a different use of the same field) and is read as picker 0's fallback so no existing recipe or dialog needs to change.
function resolveRecipeItems(character, tag, quantity, ingredientChoice, ingredientPicks) {
  const items = Array.isArray(tag.requirementItems) ? tag.requirementItems : [];
  const plan = { spend: [], hold: [] };
  if (!items.length) return plan;
  const held = character.tags.filter((ct) => ct.tag);
  const bySlug = new Map(held.map((ct) => [ct.tag.slug, ct]));
  // Merges into an existing plan.spend entry for the same tagId rather than
  // pushing a duplicate — two `anyOf` pickers can land on the same slug
  // (Fried Fish's two identical fish choices), and consumeRecipeItems must
  // see one cumulative need checked against the actual held quantity, not
  // two independent entries each individually under the total.
  const pushSpend = (ct, tagName, needed) => {
    const existing = plan.spend.find((s) => s.tagId === ct.tagId);
    const total = (existing?.quantity ?? 0) + needed;
    if (ct.quantity < total) {
      throw new UserError(
        total > 1
          ? `Making ${quantity > 1 ? `${quantity} of those` : "that"} takes ${total} × ${tagName}, and you have ${ct.quantity}.`
          : `Making that needs ${tagName}.`,
      );
    }
    if (existing) existing.quantity = total;
    else plan.spend.push({ tagId: ct.tagId, tagName, quantity: needed });
  };
  for (const item of items) {
    if (item.kind === "group") {
      if (!held.some((ct) => ct.tag.group?.slug === item.slug)) {
        throw new UserError(`Making that needs ${item.label}.`);
      }
      plan.hold.push({ kind: "group", slug: item.slug, label: item.label });
      continue;
    }
    if (item.kind === "customOf") {
      // A mint of this recipe never keeps the base slug — its trace is `customOfSlug` (mintCustomCraft); the base row still counts if held. Several candidates: take the least remarkable (lowest mealMood, then oldest), not a picker — spending a commodity, not choosing a flavour.
      const candidates = held
        .filter((ct) => ct.tag.customOfSlug === item.slug || ct.tag.slug === item.slug)
        .sort((a, b) => (a.tag.mealMood ?? 0) - (b.tag.mealMood ?? 0) || a.acquiredAt - b.acquiredAt);
      const ct = candidates[0];
      if (!ct) throw new UserError(`Making that needs ${item.label}.`);
      if (item.keep) {
        plan.hold.push({ kind: "tag", slug: ct.tag.slug, label: item.label });
        continue;
      }
      const needed = quantity * (item.count ?? 1);
      pushSpend(ct, ct.tag.name ?? item.label, needed);
      continue;
    }
    let slug = item.slug;
    if (item.kind === "anyOf") {
      const raw = Array.isArray(ingredientPicks) ? ingredientPicks[item.pickerIndex] : undefined;
      const picked = raw ?? ingredientChoice;
      const choice = typeof picked === "string" ? picked.trim() : "";
      if (!choice || !item.slugs.includes(choice)) {
        throw new UserError(`Choose which of ${item.label} goes into it.`);
      }
      slug = choice;
    }
    const ct = bySlug.get(slug);
    const name = ct?.tag?.name ?? item.label;
    if (item.keep) {
      if (!ct) throw new UserError(`Making that needs ${item.label}.`);
      plan.hold.push({ kind: "tag", slug, label: item.label });
      continue;
    }
    const needed = quantity * (item.count ?? 1);
    if (!ct) {
      throw new UserError(
        needed > 1
          ? `Making ${quantity > 1 ? `${quantity} of those` : "that"} takes ${needed} × ${name}, and you have 0.`
          : `Making that needs ${name}.`,
      );
    }
    pushSpend(ct, name, needed);
  }
  return plan;
}

// Spends what resolveRecipeItems planned, in the SAME transaction as the payment, under the row lock above. **The check is still separate from the write**: read first, a short stack refuses outright, since `dropCharacterTag`'s decrement is unconditional — safe here only because the caller already holds the row lock. Goes through `dropCharacterTag` (not a hand-rolled decrement) so poisonedCount/poisonPayload stay consistent; whether drawn units were tainted is discarded on purpose, a poisoned dose is lost in the crafting, never carried into the output.
// Returns the `replaced`-shaped snapshot the audit row records as `details.consumed` — the one record of the spend a GM repairs from.
async function consumeRecipeItems(tx, characterId, plan) {
  for (const item of plan.hold) {
    const still = await tx.characterTag.count({
      where: {
        characterId,
        tag:
          item.kind === "group"
            ? { group: { slug: item.slug } }
            : { slug: item.slug },
      },
    });
    if (!still) throw new UserError(`Making that needs ${item.label}.`);
  }
  const consumed = [];
  for (const { tagId, tagName, quantity } of plan.spend) {
    const row = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId, tagId } },
    });
    if (!row || row.quantity < quantity) {
      throw new UserError(`You don't have enough ${tagName} left for that.`);
    }
    await dropCharacterTag(tx, characterId, tagId, quantity);
    consumed.push({
      tagId,
      tagName,
      quantity,
      source: row.source,
      expiresTurn: row.expiresTurn,
    });
  }
  return consumed;
}

// Prerequisite chain, exclusivity, tier replacement, duplicates — the same checks a purchase runs (web/lib/characterCreation.js). Returns the held lower tiers a grant would replace, snapshotted for Undo.
// `db` defaults to prisma for the fast fail outside the transaction; recheckGrantsUnderLock reruns it inside the tx, since a turn can hold several Move-costing crafts racing past the same exclusivity/duplicate check.
async function craftGrantChecks(character, tag, db = prisma) {
  // The whole catalog comes down so a chain walk never dead-ends on an ancestor the character doesn't hold.
  const chainRows = await db.tag.findMany({
    select: {
      id: true,
      name: true,
      parentTagId: true,
      requiredTagId: true,
      exclusive: true,
      groupId: true,
      conflictsWith: { select: { id: true } },
    },
  });
  const chainById = buildTagsById(
    chainRows.map((t) => ({
      ...t,
      conflictsWithIds: t.conflictsWith.map((c) => c.id),
    })),
  );
  const heldIds = character.tags.map((ct) => ct.tagId);
  if (!addRequirementSatisfied(tag, chainById, heldIds)) {
    throw new UserError("You're missing a prerequisite for that tag.");
  }
  const conflict = exclusiveConflict(tag, heldIds, chainById);
  if (conflict) {
    throw new UserError(`${tag.name} can't be held with ${conflict.name}.`);
  }
  const namedConflict = conflictingTag(
    chainById.get(tag.id) ?? tag,
    heldIds,
    chainById,
  );
  if (namedConflict)
    throw new UserError(`${tag.name} conflicts with ${namedConflict.name}.`);
  // A chain replaces upward and never re-opens downward.
  if (heldHigherTiers(tag, chainById, heldIds).length > 0) {
    throw new UserError(
      `You already hold a higher tier of ${tag.name}'s chain.`,
    );
  }
  if (!tag.stackable && character.tags.some((ct) => ct.tagId === tag.id)) {
    throw new UserError("You already have that tag.");
  }
  return character.tags
    .filter((ct) =>
      chainSiblingsToRemove(tag, chainById, heldIds).includes(ct.tagId),
    )
    .map((ct) => ({
      tagId: ct.tagId,
      tagName: ct.tag?.name ?? null,
      source: ct.source,
      expiresTurn: ct.expiresTurn,
      quantity: ct.quantity,
    }));
}

// The in-tx re-run, under the Character row lock, against the sheet as it is NOW rather than when the fast fail
// read it. Stackable recipes skip it — a racing grant there only adds units, which craftGrantChecks never refuses — so everyday brews never pay for it. Returns the fresh `replaced` snapshot, which is the one the grant uses.
async function recheckGrantsUnderLock(tx, character, tag) {
  if (tag.stackable) return null;
  const fresh = await tx.characterTag.findMany({
    where: { characterId: character.id },
    include: { tag: { select: { name: true } } },
  });
  return craftGrantChecks({ ...character, tags: fresh }, tag, tx);
}

// Who pays: you, a room here, or a person here. Defaults to you.
export async function resolveCraftPayer(character, payerKey, cost) {
  const key = payerKey || `character:${character.id}`;
  // allowConcealed — same reason as the heal payer (actions/medical.js): a hood
  // is somebody standing in front of you with a purse, and resolveParty has
  // already re-checked that they are.
  const payer = await resolveParty(key, { actor: character });
  if (!payer) throw new UserError("That payer isn't here any more — pick another.");
  if (!(await canReachParty(character, payer, { allowConcealed: true })))
    throw new UserError(payer.concealed ? "They aren't here." : outOfReachMessage(payer));
  if (cost > payer.balance)
    throw new UserError(`${payer.name} only has ${payer.balance} ⬢.`);
  return payer;
}

// Smithing only: an obol is one ⬢ (DEPOT.md), so a smith may pay in any mix of the two — some off their own coin, the rest through the usual payer. Clamped to the recipe's own total (excess obols wasted); refused outright, not silently clamped, if the smith doesn't hold that many — else the payer gets billed for a mistake that wasn't theirs.
const OBOL_SLUG = "obol";
function resolveObolSpend(character, tag, totalCost, rawObolsSpent) {
  if (craftFamily(tag) !== "smithing") return { obolsSpent: 0, line: null };
  const obolsSpent = parseCount(rawObolsSpent, { min: 0, max: totalCost }) ?? 0;
  if (!obolsSpent) return { obolsSpent: 0, line: null };
  const held = character.tags.find((ct) => ct.tag?.slug === OBOL_SLUG);
  if (!held || held.quantity < obolsSpent) {
    throw new UserError(`You're carrying ${held?.quantity ?? 0} Obols.`);
  }
  return {
    obolsSpent,
    line: { tagId: held.tagId, tagName: held.tag.name ?? "Obol", quantity: obolsSpent },
  };
}

// requireFreeMove and fileAutoRoutine moved to web/lib/moveSpend.js so Thanati's Recover Equipment (thanatiActions.js) spends a Move by the same two rules as Bury, Engrave and Extract.

function craftLabel(tag, quantity) {
  return quantity > 1 ? `${quantity}× ${tag.name}` : tag.name;
}

// "Quantity Produced" (COOKING.md §A5) — recipe runs times the recipe's own
// requirementYield. Read off the RECIPE tag, never a minted custom-craft
// clone (which carries no requirementYield). Deliberately excludes
// Distilling's doubling, matching that bonus's existing precedent of never
// showing in the "made:" label — see grantCrafted's own `granted` for the
// number that actually lands in the stack.
function producedQuantity(recipeTag, quantity) {
  return quantity * (recipeTag.requirementYield ?? 1);
}


// FIFTH runtime authoring door onto the tag catalog (db/lib/paperMint.js has the other four): a `customizable` recipe mints a custom+ephemeral clone (`craftable: false`, an ITEM never a recipe) and grants THAT row. Runs OUTSIDE the craft tx (createWithRetry's P2002 retry can't nest, and name collisions are routine — reused if identical, "(2)"'d if not; caller deletes a fresh mint if the tx then fails).
// Lives in db/lib/customCraftMint.js (db/lib can't require web/); this wrapper reraises its plain Error as a UserError.
export async function mintCustomCraft(db, baseTag, opts) {
  try {
    return await dbMintCustomCraft(db, baseTag, opts);
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError(err.message);
  }
}

export async function unmintCustomCraft(db, grant) {
  return dbUnmintCustomCraft(db, grant);
}

async function grantCrafted(
  tx,
  {
    session,
    character,
    tag,
    quantity,
    openTurn,
    replaced,
    payer,
    cost,
    project = null,
    action = null,
    consumed = [],
    // The base RECIPE when `tag` is a minted custom row — what the ration counters bill against (web/lib/requests.js reads details.baseTagId), and what a GM reading the audit row sees it was.
    baseTag = null,
    // Recipe-specific extras for the audit row (the Death Mask records its source corpse here).
    extraDetails = {},
  },
) {
  for (const snapshot of replaced)
    await dropCharacterTag(tx, character.id, snapshot.tagId);
  // Brewing (Distilling): two items for the same cost. The doubling lives HERE, at the single grant every craft path funnels through, deliberately downstream of the ingredient plan and ⬢ spend (both computed from `quantity`, doubling the cost too would make the tag do nothing). Family is read off `baseTag ?? tag`, not `tag`: a minted custom row carries no requirementSkills, so craftFamily() on `tag` would read it as generic "craft" and quietly stop doubling.
  const recipeTag = baseTag ?? tag;
  const distilled =
    craftFamily(recipeTag) === "brewing" &&
    (character.tags ?? []).some((ct) => ct.tag?.slug === BREWING_DISTILLING_SLUG);
  // "Quantity Produced" (COOKING.md §A5, Tag.requirementYield) multiplies onto
  // the stack the same way Distilling's doubling does — both are downstream of
  // the ingredient plan and the ⬢ spend, which are priced off `quantity` alone
  // and must never also see either multiplier. Read off the RECIPE
  // (recipeTag), not the possibly-minted `tag` — a minted custom-craft row
  // carries no `requirementYield` of its own.
  const yielded = quantity * (recipeTag.requirementYield ?? 1);
  const granted = distilled ? yielded * 2 : yielded;
  await addToStack(tx, character.id, tag.id, granted, {
    source: "CRAFT",
    // Must arrive already stamped or it never expires — resolveNeeds()'s sweep matches on expiresTurn and nothing backfills it.
    expiresTurn: await expiryForGrant(tx, tag, openTurn, {
      characterId: character.id,
      where: "craftRequest",
    }),
    stackable: tag.stackable,
  });
  const payerParty = { kind: payer.kind, id: payer.id, name: payer.name };
  return logAudit(tx, {
    actorDiscordUserId: session.discordUserId,
    actionType: "request_craft_tag",
    targetCharacterId: character.id,
    // The ration counters below read this back; without it they can't tell this turn's work from last turn's.
    turnId: openTurn?.id ?? null,
    details: {
      tagId: tag.id,
      tagName: tag.name,
      // RECIPE RUNS, not units granted — web/lib/requests.js's per-turn rations count this, so a Distilling brewer's Dead Simple allowance isn't halved by their own doubled output. What actually landed is recorded beside it when the two differ.
      quantity,
      // Only when the doubling actually landed — addToStack pins a non-stackable tag at quantity 1 regardless, so a non-stackable brew doubles to nothing and a row claiming otherwise would lie in the GM ledger.
      ...(distilled && tag.stackable ? { granted, distilled: true } : {}),
      // Same posture, for a recipe whose "Quantity Produced" is itself > 1
      // (Pizza Slice: 3) — recorded so a GM reading the ledger sees why the
      // stack grew by more than `quantity`.
      ...(recipeTag.requirementYield && recipeTag.requirementYield !== 1 && tag.stackable
        ? { granted, yieldPerCraft: recipeTag.requirementYield }
        : {}),
      resourcesSpent: cost,
      payer: payerParty,
      projectId: project?.id ?? null,
      // The base RECIPE behind a minted custom row — web/lib/requests.js's ration counters bill by it, so a custom Lavish Meal obeys the plain one's per-turn cap.
      ...(baseTag ? { baseTagId: baseTag.id, baseTagName: baseTag.name } : {}),
      ...(project ? { turnsNeeded: project.turnsNeeded } : {}),
      ...(action ? { actionId: action.id } : {}),
      ...(replaced.length ? { replaced } : {}),
      // What the ingredients cost, in the `replaced` shape. This row is the ONLY record of the spend now — a GM repairs by hand from here. A multi-turn project spent these when it STARTED and carried the snapshot on CraftProject.consumed until now.
      ...(consumed?.length ? { consumed } : {}),
      ...extraDetails,
    },
  });
}

// --- The Death Mask (docs/tags.yaml `death-mask`) -------------------------
// The one recipe whose OUTPUT is named by an ingredient: stamped with the dead character's name, read off the corpse it was cast over. The corpse is a group ingredient and so KEPT, but a face can only be cut once — the craft marks the corpse's description and refuses one already marked; the marker doubles as the fiction, Examine says the face is gone.
const DEATH_MASK_SLUG = "death-mask";
const FACE_TAKEN_SENTENCE = "The face has been taken.";

function maskNameFor(corpseName) {
  // "Ada's Corpse" → "Ada"; "Ada's Corpse (2)" → "Ada (2)"; authored monster corpses ("Graga Corpse") lose the bare word instead.
  const who = corpseName.replace(/'s Corpse\b/, "").replace(/ Corpse\b/, "").trim();
  return `Death Mask of ${who || "Nobody"}`;
}

// Which held corpse the mask is taken from. `ingredientChoice` carries the corpse tag's SLUG (same channel an anyOf pick uses — a recipe has at most one of the two, so no collision); a single unmarked corpse is taken as chosen, the dialog's one-option convention.
function resolveDeathMaskSource(character, ingredientChoice) {
  const corpses = character.tags.filter(
    (ct) => ct.tag?.group?.slug === "items-corpse",
  );
  if (!corpses.length) throw new UserError("Making that requires a corpse.");
  const untaken = corpses.filter(
    (ct) => !(ct.tag.description ?? "").includes(FACE_TAKEN_SENTENCE),
  );
  if (!untaken.length)
    throw new UserError("Every face here has already been taken.");
  const choice = typeof ingredientChoice === "string" ? ingredientChoice.trim() : "";
  const picked = choice
    ? untaken.find((ct) => ct.tag.slug === choice)
    : untaken.length === 1
      ? untaken[0]
      : null;
  if (!picked) throw new UserError("Choose whose face the mask is taken from.");
  return { tagId: picked.tagId, name: picked.tag.name };
}

// Marks the corpse inside the craft transaction. Compare-and-swap on the exact description text, so two artists racing over one body cannot both take the face — the loser's write matches nothing and the craft refuses.
async function takeFace(tx, source) {
  const row = await tx.tag.findUnique({
    where: { id: source.tagId },
    select: { description: true },
  });
  const current = row?.description ?? "";
  if (current.includes(FACE_TAKEN_SENTENCE))
    throw new UserError("That face has already been taken.");
  const next = `${current} ${FACE_TAKEN_SENTENCE}`.trim();
  const { count } = await tx.tag.updateMany({
    where: { id: source.tagId, description: current },
    data: { description: next },
  });
  if (!count) throw new UserError("That face has already been taken.");
}

export function payerNotice(character, payer, cost, tag) {
  if (payer.kind !== "character" || payer.id === character.id || !cost) return;
  notifyCharacter(
    payer,
    `${character.name} paid ${cost} ⬢ from your purse toward ${tag.name}.`,
  );
}

export async function craftRequestImpl({
  tagId,
  quantity: rawQuantity,
  payerKey,
  // Which member of an `anyOf` ingredient goes in — a slug the dialog posts, re-checked for membership and possession like everything else a client sends. The single-picker channel; also the Death Mask's corpse pick.
  ingredientChoice,
  // One pick per `anyOf` picker, indexed by pickerIndex — a recipe with several pickers (Vegetable Stew, Fried Fish, Sweets — COOKING.md §A4) posts one entry per picker here instead of the single `ingredientChoice`. Absent falls back to `ingredientChoice` for picker 0, so a one-picker recipe needs neither field to change.
  ingredientPicks,
  // Slugs a cook slotted, in order, on a recipe with `ingredientSlots` (COOKING.md) — an ordered set out of a catalog the recipe names nothing about, unlike `ingredientChoice`'s pick from a named list. Re-checked here for membership, possession and count, so the chip list is a hint like any other disabled control.
  ingredientChoices,
  // Custom-item fields (CRAFTING.md), honored only on a `customizable` recipe. cleanCustomText decides what survives — the dialog priced the +1 ⬢ with the same helper, so client and server can't disagree on whether a whitespace-only name counts.
  customName,
  customDescription,
  // The builder's line, honored only where placement.inscribable says so.
  inscription,
  // Units the dialog TOLD the player would bill against their Move (0 if shown free). The server refuses to bill more than acknowledged — a stale tab whose free allowance ran out elsewhere gets a retry, not a silent Move charge; "Declining crafts nothing" is enforced here, not just in the dialog.
  billedSeen: rawBilledSeen,
  // Smithing only (resolveObolSpend re-checks): held Obols to put toward this recipe's cost, rest billed to the usual payer. Ignored on any other recipe.
  obolsSpent: rawObolsSpent,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const tag = await loadRecipe(tagId);
  await requireRecipeSkills(character, tag);
  // Fieldwork is the one exemption from the forge: a recipe naming builder-* skills otherwise demands Workshop Equipment in reach — right for heavy works, wrong for stakes and drying racks.
  const placement = placementOf(tag);
  if (!placement?.fieldwork) await requireWorkshop(character, tag);
  // A `placement:` recipe is BUILT ON SITE and never lands on a sheet, so the tag-tier gates below (prerequisites, exclusivity, tier replacement, stacks) have nothing to say about it. Never carries ingredients either — the sync refuses that pairing (db/lib/tagShapes.js).
  if (placement)
    return openBuildSiteImpl(character, session, tag, {
      payerKey,
      inscription,
    });
  const replaced = await craftGrantChecks(character, tag);

  const quantity = tag.stackable
    ? (parseCount(rawQuantity, { min: 1, max: 99 }) ?? 1)
    : 1;
  // Resolved once the count is known, since a spend scales with it.
  const itemPlan = resolveRecipeItems(
    character,
    tag,
    quantity,
    ingredientChoice,
    ingredientPicks,
  );
  // Ingredient slots, on top of `items` (COOKING.md). Legal set is every tag with a `cooked` block, read here rather than named on the recipe — `cooked: { not: null }` is the membership check itself.
  const posted = (Array.isArray(ingredientChoices) ? ingredientChoices : [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  const cookableRows =
    posted.length && tag.requirementIngredientSlots
      ? await prisma.tag.findMany({
          where: { slug: { in: posted }, cooked: { not: null } },
          select: { slug: true, name: true, cooked: true },
        })
      : [];
  const cookableBySlug = new Map(cookableRows.map((t) => [t.slug, t]));
  // Just the tastes, for naming a dish nobody named (mintCustomCraft) — read here since the mint runs outside the craft transaction and must not open a query of its own.
  const cookedTastes = new Map(cookableRows.map((t) => [t.slug, t.cooked?.taste ?? ""]));
  const slotPlan = await resolveIngredientSlots(character, tag, quantity, posted, cookableBySlug);
  // One plan from here on, MERGED BY TAG not concatenated: two entries naming the same stack (no recipe does today, but nothing stops one) would have consumeRecipeItems draw against it twice off two independent re-reads — a nonsensical refusal count and two `details.consumed` rows for one spend.
  for (const line of slotPlan.spend) {
    const existing = itemPlan.spend.find((s) => s.tagId === line.tagId);
    if (existing) existing.quantity += line.quantity;
    else itemPlan.spend.push(line);
  }
  const cookedFrom = slotPlan.cookedFrom;
  // The Death Mask binds a SPECIFIC corpse (the group entry above only proved one is held) — resolved out here for the fast fail, marked inside the transaction by takeFace.
  const deathMask =
    tag.slug === DEATH_MASK_SLUG
      ? resolveDeathMaskSource(character, ingredientChoice)
      : null;
  // The shared verdict the dialog prices with (web/lib/customCraft.js): what the words amount to after cleaning, and what this recipe charges (usually CUSTOM_SURCHARGE, zero on the two meals — COOKING.md). Fields posted against a non-customizable recipe are dropped, not refused — same posture as quantity on a non-stackable. `mayCustomize` reads the rung the recipe names (Tag.customizableSkillSlug) so an apprentice can't sign a cudgel; failing it drops the words AND the surcharge — nobody pays for a name they didn't get.
  const { custom: customWanted, surcharge: customSurcharge } = customCraftFor(tag, {
    customName,
    customDescription,
  });
  const mayCustom = mayCustomize(tag, heldSlugsOf(character.tags));
  const custom = mayCustom ? customWanted : { name: "", description: "", active: false };
  const surcharge = mayCustom ? customSurcharge : 0;
  const turns = tag.requirementTurns ?? 1;
  const totalCost = ((tag.requirementResources ?? 0) + surcharge) * quantity;
  const { obolsSpent, line: obolSpendLine } = resolveObolSpend(
    character,
    tag,
    totalCost,
    rawObolsSpent,
  );
  // MERGED BY TAG, same reasoning as the ingredient-slot merge above: a recipe naming `obol` as its own ingredient must not draw against the same stack twice under two separate plan entries.
  if (obolSpendLine) {
    const existing = itemPlan.spend.find((s) => s.tagId === obolSpendLine.tagId);
    if (existing) existing.quantity += obolSpendLine.quantity;
    else itemPlan.spend.push(obolSpendLine);
  }
  const cost = totalCost - obolsSpent;
  const payer = await resolveCraftPayer(character, payerKey, cost);
  const openTurn = await getOpenTurn();

  // No Move of its own, but rationed per turn where the recipe names its own `perTurn` (CRAFTING.md §2a). Units PAST the allowance no longer refuse — for a recipe with a craft family they spill into the Move at 1/allowance each, making a fifth cost something rather than be impossible. Priced twice: here for the fast fail, again inside the transaction under the row lock, since two simultaneous requests would otherwise both read the same count and pass.
  const perTurn = tag.requirementPerTurn ?? null;
  if (turns === 0) {
    const allowance = openTurn ? craftAllowance(tag) : null;
    const priceCraft = async (db) => {
      const already = allowance == null ? 0 : await unitsOfTagThisTurn(db, character.id, openTurn.id, tag.id);
      const priced = craftMoveCost(tag, {
        quantity,
        allowance,
        freeLeft: allowance == null ? null : allowance - already,
        // moveFamilyOf, not craftFamily: a recipe on the never-spills list (Obol) prices as family-less here so going past its own perTurn refuses outright instead of spilling into the Move — everywhere else in this function still reads craftFamily().
        family: moveFamilyOf(tag),
      });
      // No family to bill the overflow to (bone-mask is gated on `butcher` alone), so the ration is still a wall.
      if (priced.kind === "capped") {
        throw new UserError(
          `You can only make ${allowance} ${tag.name} per turn (${already} already this turn).`,
        );
      }
      return priced;
    };
    const billedSeen = parseCount(rawBilledSeen, { min: 0, max: 99 }) ?? 0;
    // The player is never billed more than the dialog showed them. Priced here for the fast fail, and AGAIN inside the transaction — the in-tx copy is what actually holds, since a concurrent craft may have eaten the free allowance in between.
    const acknowledgeBill = (priced) => {
      if (priced.billedQty > billedSeen) {
        throw new UserError(
          "Your free allowance changed since this page loaded — reload to see the new cost.",
        );
      }
    };
    const moveCost = await priceCraft(prisma);
    acknowledgeBill(moveCost);
    if (moveCost.kind === "spill")
      await resolveCraftMove(character, openTurn, moveCost);
    // Minted before the transaction (mintCustomCraft says why), unwound after it only if the transaction fails and the row was fresh. A DISH ALWAYS MINTS, words or no words — what went in is what it does, so it needs its own row even from a cook who named nothing; a meal with no ingredient and no words stays the plain catalog row, Depot-listable and out of the Restart Game ephemeral sweep.
    const grant =
      custom.active || cookedFrom.length
        ? await mintCustomCraft(prisma, tag, { ...custom, cookedFrom, cookedTastes })
        : null;
    try {
    await prisma.$transaction(async (tx) => {
      // One lock for all the racy things: ration counts, ingredient stacks, the grant re-check, and the Move ledger (spendCraftMove takes it again, free once this transaction holds it).
      if (allowance != null || itemPlan.spend.length || !tag.stackable) {
        await lockCharacter(tx, character.id);
      }
      const spend = await priceCraft(tx);
      acknowledgeBill(spend);
      let action = null;
      let budget = null;
      if (spend.kind === "spill") {
        // The fast fail only ran resolveCraftMove when the OUTSIDE price already spilled, so a spill first seen here re-checks the Move window itself — a craft submitted after Moves lock must not write a ledger no matter how the race fell.
        if (moveCost.kind !== "spill") {
          const gate = await movesOpen(tx, { turn: openTurn });
          if (!gate.ok) throw new UserError(gate.message);
        }
        ({ action, budget } = await spendCraftMove(tx, {
          character,
          openTurn,
          need: spend,
          entry: craftLedgerEntry(tag, spend),
        }));
      }
      const replacedNow =
        (await recheckGrantsUnderLock(tx, character, tag)) ?? replaced;
      const consumed = await consumeRecipeItems(tx, character.id, itemPlan);
      if (cost) await moveResources(tx, payer, -cost);
      await grantCrafted(tx, {
        session,
        character,
        tag: grant?.tag ?? tag,
        baseTag: grant ? tag : null,
        quantity,
        openTurn,
        replaced: replacedNow,
        payer,
        cost,
        action,
        consumed,
      });
    });
    } catch (err) {
      await unmintCustomCraft(prisma, grant);
      throw err;
    }
    await afterInventoryChange([
      character.id,
      payer.kind === "character" ? payer.id : null,
    ]);
    payerNotice(character, payer, cost, tag);
    revalidateAll();
    return { made: craftLabel(grant?.tag ?? tag, producedQuantity(tag, quantity)) };
  }

  // Real work: this turn's Move, and a project if it takes more than one. Quantity is limited by WORK ARITHMETIC and nothing else: a unit costs its `turnsCost` of the Move (a whole turn, or the decimal share a part-turn recipe authors), so a brewer's Routine holds four 0.25-turn Alcohol and a smith's holds ONE broadsword, and a spare part-turn takes more same-family work or none. A project takes the Move whole every turn it runs, so it can never share one, and makes ONE unit — wanting two means starting it twice.
  if (turns > 1 && quantity > 1) {
    throw new UserError(
      `That's ${turns} turns of work apiece — make them one at a time.`,
    );
  }
  const moveCost = craftMoveCost(tag, { quantity });
  // The cross-submission count — for a fractional recipe, `perTurn` holds its work denominator, so this and the budget agree by construction.
  const ration = async (db) => {
    if (perTurn == null || !openTurn) return;
    const already = await unitsOfTagThisTurn(
      db,
      character.id,
      openTurn.id,
      tag.id,
    );
    if (already + quantity > perTurn) {
      throw new UserError(
        `You can only make ${perTurn} ${tag.name} per turn (${already} already this turn).`,
      );
    }
  };
  await ration(prisma);
  await resolveCraftMove(character, openTurn, moveCost);
  const finishes = turns === 1;
  let done = false;
  // A finishing craft mints now (outside the tx — mintCustomCraft says why); a longer project carries the words on CraftProject.custom instead and continueCraftImpl mints them on the finishing turn. The Death Mask's stamped name rides the same machinery in literal mode.
  const grant = finishes
    ? deathMask
      ? await mintCustomCraft(prisma, tag, {
          name: maskNameFor(deathMask.name),
          description: "",
          literal: true,
        })
      : custom.active || cookedFrom.length
        ? await mintCustomCraft(prisma, tag, { ...custom, cookedFrom, cookedTastes })
        : null
    : null;
  try {
  await prisma.$transaction(async (tx) => {
    // Ingredients go in when the work starts, the same moment the ⬢ do — like the ⬢ they never come back if the project is abandoned. A project longer than a turn carries the snapshot on itself until it finishes.
    await lockCharacter(tx, character.id);
    await ration(tx);
    // The Move is claimed first: it's the contended thing, and a refusal here rolls back everything below it.
    const { action, budget } = await spendCraftMove(tx, {
      character,
      openTurn,
      need: moveCost,
      entry: craftLedgerEntry(tag, moveCost),
      // A batch craft lets the Action's description rebuild from the ledger; everything else keeps the line it has always written.
      description:
        moveCost.kind === "share"
          ? null
          : finishes
            ? `Crafted ${craftLabel(tag, quantity)}.`
            : `Crafting ${craftLabel(tag, quantity)} (1/${turns}).`,
    });
    const replacedNow =
      (await recheckGrantsUnderLock(tx, character, tag)) ?? replaced;
    const consumed = await consumeRecipeItems(tx, character.id, itemPlan);
    // The face comes off when the work starts, like every other ingredient cost — an abandoned mask still ruined the face, and no second cast can ever be taken from this body.
    if (deathMask) await takeFace(tx, deathMask);
    if (cost) await moveResources(tx, payer, -cost);
    const project = await tx.craftProject.create({
      data: {
        characterId: character.id,
        tagId: tag.id,
        quantity,
        turnsNeeded: turns,
        turnsDone: 1,
        resourcesCost: cost,
        consumed: consumed.length ? consumed : undefined,
        custom:
          deathMask && !finishes
            ? {
                deathMask: {
                  name: maskNameFor(deathMask.name),
                  sourceCorpseTagId: deathMask.tagId,
                  sourceCorpseName: deathMask.name,
                },
              }
            : custom.active && !finishes
              ? { name: custom.name, description: custom.description }
              : undefined,
        payerKey: `${payer.kind}:${payer.id}`,
        payerName: payer.name,
        startedTurnId: openTurn.id,
        lastTurnId: openTurn.id,
      },
    });
    done = finishes;
    if (done) {
      await grantCrafted(tx, {
        session,
        character,
        tag: grant?.tag ?? tag,
        baseTag: grant ? tag : null,
        quantity,
        openTurn,
        replaced: replacedNow,
        payer,
        cost,
        project,
        action,
        consumed,
        extraDetails: deathMask
          ? { sourceCorpseTagId: deathMask.tagId, sourceCorpseName: deathMask.name }
          : {},
      });
      await tx.craftProject.update({
        where: { id: project.id },
        data: { status: "DONE" },
      });
    } else {
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "craft_started",
        targetCharacterId: character.id,
        details: {
          projectId: project.id,
          tagId: tag.id,
          tagName: tag.name,
          quantity,
          turnsNeeded: turns,
          resourcesCost: cost,
          payer: { kind: payer.kind, id: payer.id, name: payer.name },
          actionId: action.id,
        },
      });
    }
  });
  } catch (err) {
    await unmintCustomCraft(prisma, grant);
    throw err;
  }
  await afterInventoryChange([
    character.id,
    payer.kind === "character" ? payer.id : null,
  ]);
  payerNotice(character, payer, cost, tag);
  revalidateAll();
  return done
    ? { made: craftLabel(grant?.tag ?? tag, producedQuantity(tag, quantity)) }
    : { started: craftLabel(tag, quantity), turns };
}

async function loadOwnProject(character, projectId) {
  const project = await prisma.craftProject.findFirst({
    where: { id: projectId ?? "", characterId: character.id, status: "ACTIVE" },
    include: {
      tag: {
        include: {
          group: { select: { requiredTagId: true } },
          requirementSkills: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  });
  if (!project)
    throw new UserError("That project isn't yours, or it's finished.");
  return project;
}

// Another turn on a project. The recipe's gates are re-run: a skill lost since the start stops the work where it stands. The INGREDIENTS are not re-checked, and must not be — spent when the work started, so an honest continue would fail its own check on turn 2.
export async function continueCraftImpl({ projectId }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  const project = await loadOwnProject(character, projectId);
  const tag = project.tag;
  await requireRecipeSkills(character, tag);
  await requireWorkshop(character, tag);
  const openTurn = await getOpenTurn();
  // A turn on a project is the whole Move, so it demands a clean one: any fraction already spent on a batch craft blocks it, and it blocks everything after it (CRAFTING.md §2a).
  const moveCost = { family: craftFamily(tag), num: 1, den: 1 };
  await resolveCraftMove(character, openTurn, moveCost);
  if (project.lastTurnId === openTurn.id)
    throw new UserError("You've already worked on that this turn.");

  const payerKeyParts = (project.payerKey ?? "").split(":");
  const payer = {
    kind: payerKeyParts[0] || "character",
    id: payerKeyParts[1] || character.id,
    name: project.payerName ?? character.name,
  };
  const next = project.turnsDone + 1;
  const done = next >= project.turnsNeeded;
  const replaced = done ? await craftGrantChecks(character, tag) : [];
  // The words stored when the work began (already cleaned then; cleaned again here since re-sanitizing is free and stored JSON is still input). Minted outside the tx — mintCustomCraft says why — and unwound if the transaction fails.
  const pendingCustom =
    done && project.custom && typeof project.custom === "object"
      ? customCraftFields({
          customName: project.custom.name,
          customDescription: project.custom.description,
        })
      : { active: false };
  // A Death Mask project stamped its name (and source corpse) at start — stored under its own key so customCraftFields above ignores it.
  const pendingMask =
    done && project.custom && typeof project.custom === "object" && project.custom.deathMask
      ? project.custom.deathMask
      : null;
  const grant = pendingMask
    ? await mintCustomCraft(prisma, tag, {
        name: pendingMask.name,
        description: "",
        literal: true,
      })
    : pendingCustom.active
      ? await mintCustomCraft(prisma, tag, pendingCustom)
      : null;
  try {
  await prisma.$transaction(async (tx) => {
    const claim = await tx.craftProject.updateMany({
      where: { id: project.id, status: "ACTIVE", turnsDone: project.turnsDone },
      data: { turnsDone: next, lastTurnId: openTurn.id },
    });
    if (claim.count === 0)
      throw new UserError("That project moved on without you — reload.");
    const { action, budget } = await spendCraftMove(tx, {
      character,
      openTurn,
      need: moveCost,
      entry: {
        tagId: tag.id,
        name: tag.name,
        qty: project.quantity,
        num: 1,
        den: 1,
      },
      description: done
        ? `Crafted ${craftLabel(tag, project.quantity)}.`
        : `Crafting ${craftLabel(tag, project.quantity)} (${next}/${project.turnsNeeded}).`,
    });
    if (done) {
      const replacedNow =
        (await recheckGrantsUnderLock(tx, character, tag)) ?? replaced;
      await grantCrafted(tx, {
        session,
        character,
        tag: grant?.tag ?? tag,
        baseTag: grant ? tag : null,
        quantity: project.quantity,
        openTurn,
        replaced: replacedNow,
        payer,
        cost: project.resourcesCost,
        project,
        action,
        // Spent back when the work began; carried here so the audit row
        // records the full price of the finished thing.
        consumed: Array.isArray(project.consumed) ? project.consumed : [],
        extraDetails: pendingMask
          ? {
              sourceCorpseTagId: pendingMask.sourceCorpseTagId,
              sourceCorpseName: pendingMask.sourceCorpseName,
            }
          : {},
      });
      await tx.craftProject.update({
        where: { id: project.id },
        data: { status: "DONE" },
      });
    } else {
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "craft_continued",
        targetCharacterId: character.id,
        details: {
          projectId: project.id,
          tagId: tag.id,
          tagName: tag.name,
          turnsDone: next,
          turnsNeeded: project.turnsNeeded,
          actionId: action.id,
        },
      });
    }
  });
  } catch (err) {
    await unmintCustomCraft(prisma, grant);
    throw err;
  }
  if (done) await afterInventoryChange(character.id);
  revalidateAll();
  return done
    ? { made: craftLabel(grant?.tag ?? tag, producedQuantity(tag, project.quantity)) }
    : {
        continued: craftLabel(tag, project.quantity),
        turnsDone: next,
        turns: project.turnsNeeded,
      };
}

// Stopping keeps nothing: the ⬢ AND the ingredients went into materials when
// the work began, and neither comes back.
export async function cancelCraftImpl({ projectId }) {
  const { session, character } = await requireCharacter();
  const project = await loadOwnProject(character, projectId);
  await prisma.$transaction(async (tx) => {
    await tx.craftProject.update({
      where: { id: project.id },
      data: { status: "CANCELLED" },
    });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "craft_cancelled",
      targetCharacterId: character.id,
      details: {
        projectId: project.id,
        tagId: project.tagId,
        tagName: project.tag.name,
        turnsDone: project.turnsDone,
        turnsNeeded: project.turnsNeeded,
        resourcesCost: project.resourcesCost,
      },
    });
  });
  revalidateAll();
  return { cancelled: project.tag.name };
}

