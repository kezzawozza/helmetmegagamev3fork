"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { TURNS_PATH } from "@/lib/routes";
import { redirect } from "next/navigation";
import { prisma, isDynastyHead, isDynastyMember, canOpenCrate } from "@lifeweb/db";
import { resolveParty as dbResolveParty } from "@lifeweb/db/lib/parties";
import { linkBetween, crossingCheck } from "@lifeweb/db/lib/locationGraph";
import { heldReasonFor } from "@lifeweb/db/lib/intercept";
import { blocksOnFoot, equippedSlugs } from "@lifeweb/db/lib/mounts";
import { applyHiddenCures } from "@lifeweb/db/lib/hiddenCures";
import {
  applyTransfer,
  InsufficientResourcesError,
} from "@lifeweb/db/lib/resourceTransfer";
import {
  canSendBird as holdsBirdAndLetters,
  isBirdReachableZone,
  deliveryDm,
  sentReceiptDm,
  replyButtonRow,
  canReadLetters,
} from "@lifeweb/db/lib/bird";
import { readBlock, CANNOT_READ } from "@lifeweb/db/lib/reading";
import { auth, CANONICAL_ORIGIN } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { INDESTRUCTIBLE_SLUGS } from "@lifeweb/db/lib/nuke";
import {
  presentedIdentity,
  forcedNameFrom,
  concealmentFrom,
} from "@lifeweb/db/lib/presentedIdentity";
import {
  logAudit,
  MAX_REASON_LENGTH,
  craftAllowance,
  unitsOfTagThisTurn,
  deadSimpleUnitsThisTurn,
  MEDICAL_SIMPLE_PER_TURN,
} from "@/lib/requests";
import {
  WHOLE_MOVE,
  addFractions,
  craftFamilyLabel,
  craftMoveCost,
  fitsInRemaining,
  formatMoveFraction,
  ledgerRemaining,
  ledgerUsed,
} from "@/lib/craftBudget";
import { UserError, guarded } from "@/lib/actionResult";
import { describeTurn } from "@/lib/turnFormat";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { requireFreeMove, fileAutoRoutine } from "@/lib/moveSpend";
import {
  DISGUISE_KIT_SLUG,
  DISGUISE_TURNS,
  normalizeDisguiseName,
  mintDisguise,
  activeDisguise,
} from "@lifeweb/db/lib/disguiseMint";
import {
  isTradeable,
  isCrate,
  isMount,
  addRequirementSatisfied,
  craftFamily,
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
  creditResources,
  debitResources,
  dropCharacterTag,
  grantTagSlugs,
  moveResources,
  takeTagFrom,
  giveTagTo,
} from "@/lib/tagEffects";
import {
  HEAL_SKILL_SLUG,
  buildSkillAncestry,
  countsAgainstHealCap,
  healCost,
  isGambitHeal,
  isHealable,
  isInflictable,
  needsSurgicalSite,
  satisfiedSkillIds,
} from "@/lib/healRequests";
import {
  canReachParty,
  outOfReachMessage,
  isOwnFactionSilo,
} from "@/lib/transferReach";
import { isHere, notHereMessage } from "@/lib/peopleHere";
import { resolveHoodToken } from "@lifeweb/db/lib/whosHere";
import {
  applyBind,
  createBindOffer,
  needsNoConsent,
  isBound as isBoundTarget,
  requireBoundTag,
  BIND_SELECT,
} from "@lifeweb/db/lib/bind";
import { createLessonOffer } from "@lifeweb/db/lib/lessons";
import { createConfessionOffer } from "@lifeweb/db/lib/confession";
import { createKissOffer, KISS_SELECT } from "@lifeweb/db/lib/kiss";
import { resolveConsumeGrants, heldSlugsOf, resistSlugsOf } from "@/lib/consumeGrants";
import { canDetectPoison } from "@lifeweb/db/lib/poison";
import { recordArchiveEvent } from "@/lib/archive";
import {
  syncCharacterNarrowcastAccess,
  syncCharacterNickname,
  ensureCharacterRole,
  removeGhostRole,
  sendDm,
  killCharacter,
} from "@/lib/discordGuild";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { getMyFactionRole } from "@/lib/factionPermissions";
import { taxRoster } from "@lifeweb/db/lib/taxTargets";
import { fileTax } from "@lifeweb/db/lib/tax";
import { TAXMAN_SLUG } from "@lifeweb/db/lib/constants";
// The die that walking into the dark wakes. It belongs to the Stepstone
// below: a step lands you somewhere the same way a walk does. The stone
// refuses an underground target now, so this can no longer fire from one —
// it stays because every writer of locationId owes the roll, and loosening
// the refusal must not silently drop it.
import { rollCavingOnArrival, cavingHoldFor } from "@lifeweb/db/lib/cavingPass";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { breakSeal } from "@lifeweb/db/lib/paperMint";
import { CAMERA_SLUG, attachPhoto, createBlankPhotoRow } from "@lifeweb/db/lib/photoMint";
import { announceInRoom } from "@lifeweb/db/lib/roomAnnounce";
import { corpsesInReach } from "@lifeweb/db/lib/corpses";
import { partFor, resolveMutilation } from "@lifeweb/db/lib/mutilate";
import { mintHeadstone } from "@lifeweb/db/lib/headstone";
import { dropRoomTag, clampEquippedQuantity, lockRoom } from "@lifeweb/db/lib/tagWrites";
import { WANTED_SLUG } from "@lifeweb/db/lib/wanted";
import {
  BUTCHER_SLUG,
  ENGRAVE_RESOURCE_COST,
  WORKSHOP_EQUIPMENT_SLUG,
  SURGICAL_EQUIPMENT_SLUG,
  PORTABLE_SURGICAL_PACK_SLUG,
  TORTURING_EQUIPMENT_SLUG,
  TORTURER_SLUG,
  MUTILATE_GATE_SLUGS,
  PACKAGING_EQUIPMENT_SLUG,
  PACKAGE_MAX_LBS,
  PACKAGE_MAX_UNITS,
  PACKAGE_LABEL_MAX,
  WHISPER_MAX,
  IMPERTURBABLE_SLUG,
  BREWING_DISTILLING_SLUG,
} from "@lifeweb/db/lib/constants";
import {
  resolveTorture,
  formatTortureRoll,
  buildTortureEmbed,
} from "@lifeweb/db/lib/torture";
import { EXAMINE_SUBJECT_SELECT, tortureReadout } from "@lifeweb/db/lib/examine";
import {
  hasAttribute,
  GODFLESH_ATTRIBUTE,
} from "@lifeweb/db/lib/locationAttributes";
import { crateWeight } from "@lifeweb/db/lib/depotCrates";
import {
  GODFLESH_SLUG,
  extractToolFor,
  rollExtraction,
  extractionDm,
  extractDayKey,
} from "@lifeweb/db/lib/godflesh";
import { hasEquipmentInReach } from "@lifeweb/db/lib/equipmentReach";
import { carryAdmits, rowWeight } from "@lifeweb/db/lib/carry";
import { rollWithAdvantage } from "@lifeweb/db/lib/advantage";
import { gambitModifierTotal, gambitModifiers } from "@lifeweb/db/lib/gambitModifier";
import {
  mintCustomCraft as dbMintCustomCraft,
  unmintCustomCraft as dbUnmintCustomCraft,
} from "@lifeweb/db/lib/customCraftMint";
import {
  CUSTOM_SURCHARGE,
  INSCRIPTION_MAX,
  cleanCustomText,
  customCraftFields,
  mayCustomize,
  customCraftFor,
} from "@/lib/customCraft";
import { mergeDishGrants, mergeDishCures, tasteLine } from "@/lib/cooking";
import { formatManifest, formatStack } from "@lifeweb/db/lib/roomStash";
import { rollTagChain } from "@lifeweb/db/lib/tagShapes";
import {
  RESEARCH_TAG_SLUG,
  CATHEDRAL_LOCATION_SLUG,
  researchMarker,
  loadResearchCatalog,
  researchableHeld,
} from "@lifeweb/db/lib/research";
import {
  BASE_BIRD_SENDS_PER_DAY,
  birdAllowanceFrom,
  rookeryCooldown,
} from "@lifeweb/db/lib/rookery";
import {
  placementOf,
  structuresAt,
  WORKING_STATUSES,
  canBuildHere,
  PRESENT_STATUSES,
  siteOpenedLine,
  siteAdvancedLine,
  siteCompletedLine,
  siteCancelledLine,
  stakeholderCharacterIds,
} from "@lifeweb/db/lib/structures";
import { ambientLine } from "@lifeweb/db/lib/ambientLine";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { evaluateDesireCatalog, slotStates, desireSlotsNeverLock } from "@lifeweb/db/lib/desireGates";
import {
  projectDesireTemplateForGates,
  loadRoleBySlugForTemplates,
  computeHiddenDesireTagIds,
} from "@/lib/desireProjection";
import {
  INCAPACITATING_SLUGS,
  FINISHABLE_SLUGS,
  blockerFor,
  ACT,
  SPEAK,
} from "@lifeweb/db/lib/incapacitation";
import {
  applyMood,
  applyMoodTerms,
  consumeReliefFor,
  dishMoodTerms,
  woundMoodFor,
  DESIRE_RELIEF_PER_POINT,
} from "@lifeweb/db/lib/mood";
import {
  NAME_LIMITS,
  FULL_NAME_LIMIT,
  formatCharacterName,
  formatBareName,
  matchesTypedName,
} from "@/lib/characterName";
import { propagateDynastyLastName } from "@/lib/dynasty";

// Every player-initiated change that applies immediately and is reviewed
// afterwards. Each action: authenticate, re-validate everything the client
// sent (a server action is a public endpoint), then apply the effect and
// write the Request + AuditLog rows in ONE transaction.

// The one generic rejection text a hidden Desire and a nonexistent/retired
// one both answer with, so the wording itself can't be an oracle (DESIRES §5).
const DESIRE_NOT_AVAILABLE = "That Desire isn't available to you.";

// `needs` is a capability from db/lib/incapacitation.js — pass ACT and the
// action refuses for anyone Bound, Dying, Paralyzed, Catatonic, mid-Seizure
// or out cold, naming the tag that stopped them. Hung here rather than
// re-written at each call site because this function already loads every held
// tag with its catalog row, so the gate costs no extra query, and because the
// inline copies it replaces had drifted: some actions checked, most didn't.
//
// Omit it for the handful that shouldn't care. Reading your own sheet is not
// an act, and neither is paperwork.
async function requireCharacter({ needs = null } = {}) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    // The held tags carry their GROUP as well as themselves: resolveRecipeItems
    // matches a recipe's `{ group: … }` ingredient against it, and
    // db/lib/corpses.js#isCorpseTag is a group check too.
    include: {
      tags: {
        include: { tag: { include: { group: { select: { slug: true } } } } },
      },
      // Half of db/lib/reading.js's `where` — Sun Sensitivity needs to know
      // whether there is a roof overhead.
      location: { select: { indoors: true } },
      role: { select: { slug: true } },
    },
  });
  if (!character) redirect("/character");
  if (needs) {
    const blocker = blockerFor(character.tags, needs);
    if (blocker) {
      throw new UserError(
        needs === SPEAK
          ? `You can't speak right now — you're ${blocker.name}.`
          : `You can't do that right now. You're ${blocker.name}.`,
      );
    }
  }
  return { session, character };
}

function revalidateAll() {
  revalidatePath("/character");
  revalidatePath("/faction");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

function parseCount(raw, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// --- Parties ------------------------------------------------------------

// "character:<id>" / "room:<id>" on both ends. Lives in db/lib/parties.js
// beside applyTransfer, so every transfer surface resolves the same key;
// re-exported here (prisma bound).
function resolveParty(key, opts) {
  return dbResolveParty(prisma, key, opts);
}

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
  // requirementItems rides along on the full row `include` gives us — see
  // resolveRecipeItems below. Nothing to add here; noted because a narrower
  // `select` on this query would silently disable ingredient checking.
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

// Smithing and building need a forge; ordinary crafting needs your hands.
//
// The rule is read off the recipe's own skills rather than a per-tag flag, so
// a new sword is gated the moment it names a smithing skill and nobody has to
// remember a second field. Reach is "hold it, or stand somewhere one is set
// up" (db/lib/equipmentReach.js) — which is what makes the Factory floor and
// the Keep's forge worth walking to. See docs/systemdocs/SMITHING.md.
async function requireWorkshop(character, tag) {
  if (!needsWorkshop(tag)) return;
  if (await hasEquipmentInReach(prisma, character, WORKSHOP_EQUIPMENT_SLUG))
    return;
  throw new UserError(
    `Making that is smith's work: hold Workshop Equipment, or stand somewhere a set is already put up.`,
  );
}

// The recipe's INGREDIENTS (Tag.requirementItems), resolved against what the
// crafter is holding. Runs OUTSIDE the transaction, so somebody who can't make
// it is told before a single ⬢ moves.
//
// Most ingredients are SPENT, `quantity` units per craft — three molotovs take
// three Alcohol, the same way they take three lots of ⬢. An entry may also
// carry its own `count`, which multiplies: a blank book takes ten sheets, and
// three of them take thirty. An entry marked
// `keep` is the old hold-check instead: a body has its own lifecycle, so
// bottling a second Miasma over the same corpse is still allowed. A `group`
// entry is always kept, and is the only thing that can name a corpse written
// at death (that tag is not in docs/tags.yaml, so no authored slug could ever
// have named it). An `anyOf` entry is a spend the PLAYER picks — the Craft
// dialog posts `ingredientChoice`, and the membership check here is what makes
// that dialog a hint rather than a lock.
//
// Your OWN sheet only — never a room stash you could reach. Spending happens
// once, when the work STARTS: a multi-turn project pays its ingredients up
// front, the rule its ⬢ already lived under, so a continue re-checks nothing
// about them.
// INGREDIENT SLOTS (docs/systemdocs/COOKING.md) ride alongside `items` rather
// than inside it. `ingredientChoices` is the array the cooking dialog posts:
// the slugs the cook slotted, in order.
//
// Membership is not a list on the recipe — it is "any tag carrying a `cooked`
// block", which is why the caller resolves the rows and hands them in as
// `cookableBySlug`. A recipe never has to be edited to accept a new
// ingredient, and this function never has to know what any of them are. That
// genericity is what lets `web/app/(app)/character/trinketActions.js` reuse
// this exact function for a SECOND, disjoint pool — "any tag carrying an
// `inlayValue`" — by handing in its own map under the same name. The two
// pools never overlap: cooking and Trinket read different columns, so a stew
// ingredient can never be slotted into a Trinket and vice versa.
// `ingredientChoices` arrives ALREADY cleaned (trimmed, blanks dropped) — the
// caller has to clean it anyway to look the rows up, and cleaning it twice is
// how the two copies drift.
export async function resolveIngredientSlots(character, tag, quantity, ingredientChoices, cookableBySlug) {
  const slots = tag.requirementIngredientSlots;
  const plan = { spend: [], cookedFrom: [] };
  const picks = ingredientChoices ?? [];
  if (!slots) {
    // Picks posted at a recipe with no slots are ignored rather than refused,
    // the same posture quantity takes on a non-stackable.
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
  // No slug twice. It keeps "it tastes like onion and onion" off the notice,
  // and it keeps the spend honest: two slots naming one stack would plan two
  // independent draws against it and the second refusal would name a count
  // nobody could make sense of.
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

function resolveRecipeItems(character, tag, quantity, ingredientChoice) {
  const items = Array.isArray(tag.requirementItems) ? tag.requirementItems : [];
  const plan = { spend: [], hold: [] };
  if (!items.length) return plan;
  const held = character.tags.filter((ct) => ct.tag);
  const bySlug = new Map(held.map((ct) => [ct.tag.slug, ct]));
  for (const item of items) {
    if (item.kind === "group") {
      if (!held.some((ct) => ct.tag.group?.slug === item.slug)) {
        throw new UserError(`Making that needs ${item.label}.`);
      }
      plan.hold.push({ kind: "group", slug: item.slug, label: item.label });
      continue;
    }
    if (item.kind === "customOf") {
      // A mint of this recipe never keeps the base slug — its only trace of
      // where it came from is `customOfSlug` (mintCustomCraft). The base row
      // itself still counts, for the rare case it's what's actually held.
      // Several candidates: take the least remarkable one (lowest mealMood,
      // then oldest), not a picker — the player is spending a commodity, not
      // choosing a flavour.
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
      if (ct.quantity < needed) {
        throw new UserError(
          needed > 1
            ? `Making ${quantity > 1 ? `${quantity} of those` : "that"} takes ${needed} × ${item.label}, and you have ${ct.quantity}.`
            : `Making that needs ${item.label}.`,
        );
      }
      plan.spend.push({ tagId: ct.tagId, tagName: ct.tag.name ?? item.label, quantity: needed });
      continue;
    }
    let slug = item.slug;
    if (item.kind === "anyOf") {
      const choice =
        typeof ingredientChoice === "string" ? ingredientChoice.trim() : "";
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
    if (!ct || ct.quantity < needed) {
      throw new UserError(
        needed > 1
          ? `Making ${quantity > 1 ? `${quantity} of those` : "that"} takes ${needed} × ${name}, and you have ${ct?.quantity ?? 0}.`
          : `Making that needs ${name}.`,
      );
    }
    plan.spend.push({ tagId: ct.tagId, tagName: name, quantity: needed });
  }
  return plan;
}

// The serializer every craft that touches a ration or a stack takes first.
// Postgres holds it to the end of the transaction, so two tabs submitting at
// once queue up instead of both reading the same count.
function lockCharacter(tx, characterId) {
  return tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR UPDATE`;
}

// Spends what resolveRecipeItems planned, inside the SAME transaction as the
// payment and under the row lock above.
//
// **The check is still separate from the write.** The row is read first and
// a short stack refuses the craft outright — `dropCharacterTag`'s own
// decrement is unconditional (it deletes whatever exists rather than
// refusing an overdraw), so this function keeps the refusal in front of it
// rather than after. What changed (fix round M4b, fix 4): the actual spend
// now goes through `dropCharacterTag` instead of a hand-rolled
// decrement/delete, because a manual write here knew nothing about
// `poisonedCount`/`poisonPayload` — crafting off a poisoned stack used to
// leave the row's poison columns untouched while quantity shrank under
// them, eventually driving poisonedCount above quantity. Safe to do
// unconditionally here specifically because every caller already holds the
// character row lock (taken above, or by the caller per its own comment)
// before this runs, so nothing can shrink the row between the check and the
// drop. The draw itself — whether any of the units actually spent were
// tainted — is discarded on purpose: a poisoned ingredient's dose is lost
// in the crafting rather than carried into the output (that's as far as
// this fix goes; whether a crafted item should ever inherit input taint is
// a product question for later, not answered here).
//
// Returns the `replaced`-shaped snapshot the audit row records as
// `details.consumed` — the one record of the spend a GM repairs from.
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

// Prerequisite chain, exclusivity, tier replacement, duplicates — the same
// checks a purchase runs (web/lib/characterCreation.js). Returns the held
// lower tiers a grant would replace, snapshotted for Undo.
//
// `db` defaults to prisma for the fast fail outside the transaction; the
// grant paths run it AGAIN inside the tx via recheckGrantsUnderLock below,
// because a turn can now hold several Move-costing crafts and two of them
// racing could otherwise both pass an exclusivity or duplicate check that
// was true when each one read the sheet.
async function craftGrantChecks(character, tag, db = prisma) {
  // The whole catalog comes down so a chain walk never dead-ends on an
  // ancestor the character doesn't hold.
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

// The in-tx re-run, under the Character row lock, against the sheet as it is
// NOW rather than as it was when the fast fail read it. Stackable recipes
// skip it — a racing grant there only adds units to a stack, which nothing
// in craftGrantChecks refuses — so the everyday brews never pay for it.
// Returns the fresh `replaced` snapshot, which is the one the grant uses.
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
  const payer = await resolveParty(key);
  if (!payer) throw new UserError("That payer isn't here any more — pick another.");
  if (!(await canReachParty(character, payer)))
    throw new UserError(outOfReachMessage(payer));
  if (cost > payer.balance)
    throw new UserError(`${payer.name} only has ${payer.balance} ⬢.`);
  return payer;
}

// requireFreeMove and fileAutoRoutine moved to web/lib/moveSpend.js so the
// Thanati's Recover Equipment (thanatiActions.js) spends a Move by the same
// two rules as Bury, Engrave and Extract.

function craftLabel(tag, quantity) {
  return quantity > 1 ? `${quantity}× ${tag.name}` : tag.name;
}

// --- The craft Move budget (docs/systemdocs/CRAFTING.md §2a) -----------
//
// A craft that costs less than a whole Move files the same auto:craft Action
// every craft with turns files, and writes a LEDGER on it
// (`Action.craftBudget`): the family of work the Routine is committed to, how
// much of the Move is spent, and what was made. The next craft that turn reads
// that ledger back — same family, and enough left, or it is refused.
//
// Nothing is derived and nothing is cached: the row IS the record, which is
// why a GM Reject hands the whole turn back with one delete
// (web/lib/moveEconomy.js#deleteActionRestoringTurn needs no knowledge of any
// of this). There is no per-craft Undo; a GM reversing one craft by hand
// gets no budget back either — Reject is the full reset.

const MOVE_SPENT = "You've already used your Move this turn.";

// The Action's description, rebuilt from the ledger every time an entry lands,
// so a GM reading the desk sees the whole turn's work in one line rather than
// only the first thing made.
function craftLedgerDescription(entries) {
  const made = entries.map((e) => (e.qty > 1 ? `${e.qty}× ${e.name}` : e.name));
  return `Crafting this turn: ${made.join(", ")}.`;
}

// Heal's own ledger line (M2, docs/systemdocs/CRAFTING.md §2a /
// TAGS.md §5c) — same shape as craftLedgerDescription, but "Treating" is the
// medic's verb, and a fresh string rather than a parameter on that one so the
// existing crafting copy stays exactly as it was. spendCraftMove picks
// between the two by family, since a turn's Routine is always one or the
// other and never both.
function healLedgerDescription(entries) {
  const made = entries.map((e) => (e.qty > 1 ? `${e.qty}× ${e.name}` : e.name));
  return `Treating this turn: ${made.join(", ")}.`;
}

function craftLedgerEntry(tag, cost) {
  return {
    tagId: tag.id,
    name: tag.name,
    // The free half of a straddling order is derivable: qty - num billed.
    qty: cost.freeQty + cost.billedQty,
    num: cost.num,
    den: cost.den,
  };
}

// Reads the turn's Action against what this craft needs. Returns the ledger to
// extend — null when there is no Action yet and this craft will file one — or
// throws the refusal.
//
// Called TWICE for every budget craft: once outside the transaction, so
// somebody who cannot act is told before a single ⬢ moves, and again inside it
// under the Character row lock, where the answer is the one that counts.
function checkCraftMove(action, need) {
  // Asked for more than a turn holds — 20 work knives is five Moves' worth of
  // spill — which an empty turn would otherwise wave through, since there is
  // no ledger yet to fail against.
  if (!fitsInRemaining(need, WHOLE_MOVE)) {
    throw new UserError(
      "That's more than a turn's work — make fewer at once.",
    );
  }
  if (!action) return null;
  // A recipe with no craft family can neither lock a Routine nor share one, in
  // either direction — so anything already filed stops it.
  if (!need.family) throw new UserError(MOVE_SPENT);
  // `includes`, not equality: other machinery APPENDS to gmNotes (the staged
  // push does, on Actions it claims), and an appended note must not strand a
  // half-spent ledger behind "Move already used".
  if (!(action.gmNotes ?? "").includes("auto:craft") || !action.craftBudget)
    throw new UserError(MOVE_SPENT);
  const ledger = action.craftBudget;
  if (ledger.family !== need.family) {
    throw new UserError(
      `Your Routine this turn is ${craftFamilyLabel(ledger.family)} work, and that isn't.`,
    );
  }
  const left = ledgerRemaining(ledger);
  if (!fitsInRemaining(need, left)) {
    const asks =
      need.num >= need.den
        ? "a whole Move"
        : `${formatMoveFraction(need.num, need.den)} of a Move`;
    throw new UserError(
      left.num > 0
        ? `That takes ${asks}, and you have ${formatMoveFraction(left.num, left.den)} of this turn's Routine left.`
        : `That takes ${asks}, and this turn's Routine is spent.`,
    );
  }
  return ledger;
}

// The fast fail, outside the transaction. Replaces requireFreeMove on the
// craft path only — Bury, Engrave, Extract and the build sites still take a
// whole clean Move and keep it.
async function resolveCraftMove(character, openTurn, need) {
  if (!openTurn) throw new UserError("No turn is open.");
  // Same source requireFreeMove reads (review fix, M2): moveWindow() takes
  // `clockFrozen`, not `autoTurnAdvanceDisabled` — the two prior reads here
  // built an options object moveWindow never destructured, so the lock check
  // silently always ran with clockFrozen defaulted false. clockFrozen(prisma)
  // is the one real answer (db/lib/gameState.js): phase !== RUNNING OR the
  // config flag, in one round trip.
  const { locked } = moveWindow(openTurn, { clockFrozen: await clockFrozen(prisma) });
  if (locked) throw new UserError("Moves are locked for this turn.");
  const action = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true, gmNotes: true, craftBudget: true },
  });
  checkCraftMove(action, need);
}

// Claims the Move — or the slice of it — this craft needs, inside the caller's
// transaction. Everything checkCraftMove looked at outside is read again here
// under the Character row lock, because two tabs can both have passed the
// cheap check a moment ago. The `@@unique([characterId, turnId])` P2002 catch
// in fileAutoRoutine stays the backstop underneath even that.
//
// `description` is what the Action says when this craft is the one that files
// it. A project turn passes its own "(2/3)" line and keeps it — a project
// never shares a turn, so nothing rebuilds it. A fractional craft passes none,
// and gets the running list of everything made this turn instead.
async function spendCraftMove(
  tx,
  { character, openTurn, need, entry, description = null },
) {
  await lockCharacter(tx, character.id);
  const existing = await tx.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true, gmNotes: true, craftBudget: true },
  });
  const ledger = checkCraftMove(existing, need);
  // No family, no ledger: the craft takes the whole Move the way it always
  // has, and the next one that turn is refused by the Action's own existence.
  if (!need.family) {
    return {
      action: await fileAutoRoutine(
        tx,
        character,
        openTurn,
        description,
        "auto:craft",
      ),
      budget: null,
    };
  }
  const entries = [...(ledger?.entries ?? []), entry];
  const used = addFractions(ledgerUsed(ledger), need);
  const budget = {
    family: need.family,
    usedNum: used.num,
    usedDen: used.den,
    entries,
  };
  // Medical shares this exact ledger (M2) but reads "Treating", not
  // "Crafting" — the family already says which, since a turn commits to one.
  const line =
    description ??
    (need.family === "medical" ? healLedgerDescription(entries) : craftLedgerDescription(entries));
  if (!existing) {
    return {
      action: await fileAutoRoutine(
        tx,
        character,
        openTurn,
        line,
        "auto:craft",
        budget,
      ),
      budget,
    };
  }
  // `updateMany` + count, not `update`: a GM Reject deletes the Action row
  // without taking the Character lock, and racing it should read as "your
  // turn was just reset", not as a raw P2025.
  const { count } = await tx.action.updateMany({
    where: { id: existing.id },
    data: { craftBudget: budget, description: line },
  });
  if (count === 0)
    throw new UserError("A GM just reset your turn — try again.");
  return { action: existing, budget };
}

// The finished thing lands on the sheet: the replaced tiers come off, the
// tag goes on with its clock, and the ADD_TAG request records all of it.
// The FIFTH runtime authoring door onto the tag catalog (db/lib/paperMint.js
// lists the other four): a `customizable` recipe crafted with player words
// mints a clone of the base row — custom + ephemeral, `craftable: false` so
// it is an ITEM and never a recipe — and the craft grants THAT row. Runs
// OUTSIDE the craft transaction, deliberately: createWithRetry's P2002 retry
// is unusable inside one (paperMint.js documents the 25P02 trap), and the
// composed name collides ROUTINELY — the same cook naming the same dish
// twice is the normal case, not the freak one. Two answers, in order: an
// identical existing mint (same name, same words) is REUSED, so the second
// batch of "Steak Dinner (Lavish Meal)" stacks onto the first; a same-name,
// different-words mint picks up a "(2)" via the retry. The caller deletes a
// freshly minted row if the transaction it fed then fails.
//
// The mint itself now lives in db/lib/customCraftMint.js — Trinket's
// turn-end pass (db/lib/trinketPass.js) needs it too, and db/lib can never
// require anything under web/, so the only way to share it was to move it
// there and have this side become the thin wrapper: catch the plain Error
// that side throws and reraise it as the UserError a server action needs.
// Every existing call site (cooking, the Death Mask, …) is unchanged.
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
    // The base RECIPE when `tag` is a minted custom row — what the ration
    // counters bill this grant against (web/lib/requests.js reads
    // details.baseTagId), and what a GM reading the audit row sees it was.
    baseTag = null,
    // Recipe-specific extras for the audit row (the Death Mask records its
    // source corpse here).
    extraDetails = {},
  },
) {
  for (const snapshot of replaced)
    await dropCharacterTag(tx, character.id, snapshot.tagId);
  // Brewing (Distilling): two items for the same cost. The doubling lives
  // HERE, at the single grant every craft path funnels through, rather than
  // beside the three callers — and deliberately downstream of the ingredient
  // plan and the ⬢ spend, which are both computed from `quantity` and must
  // stay that way. Doubling the cost as well would make the tag do nothing.
  //
  // The family is read off `baseTag ?? tag`, not `tag`: when a recipe mints a
  // custom row the minted tag carries no requirementSkills, so craftFamily()
  // would read it as the generic "craft" and quietly stop doubling.
  const recipeTag = baseTag ?? tag;
  const distilled =
    craftFamily(recipeTag) === "brewing" &&
    (character.tags ?? []).some((ct) => ct.tag?.slug === BREWING_DISTILLING_SLUG);
  const granted = distilled ? quantity * 2 : quantity;
  await addToStack(tx, character.id, tag.id, granted, {
    source: "CRAFT",
    // Must arrive already stamped or it never expires — resolveNeeds()'s
    // sweep matches on expiresTurn and nothing backfills it.
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
    // The ration counters below read this back; without it they cannot tell
    // this turn's work from last turn's.
    turnId: openTurn?.id ?? null,
    details: {
      tagId: tag.id,
      tagName: tag.name,
      // RECIPE RUNS, not units granted — the per-turn rations in
      // web/lib/requests.js count this, so a Distilling brewer must not have
      // their Dead Simple allowance halved by their own doubled output.
      // What actually landed is recorded beside it when the two differ.
      quantity,
      // Only when the doubling actually landed. addToStack pins a
      // non-stackable tag at quantity 1 however many are granted, so a
      // non-stackable brew doubles to nothing — and a row claiming otherwise
      // is a lie in the GM ledger rather than a rounding error.
      ...(distilled && tag.stackable ? { granted, distilled: true } : {}),
      resourcesSpent: cost,
      payer: payerParty,
      projectId: project?.id ?? null,
      // The base RECIPE behind a minted custom row — the ration counters in
      // web/lib/requests.js bill by it, so a custom Lavish Meal obeys the
      // plain one's per-turn cap.
      ...(baseTag ? { baseTagId: baseTag.id, baseTagName: baseTag.name } : {}),
      ...(project ? { turnsNeeded: project.turnsNeeded } : {}),
      ...(action ? { actionId: action.id } : {}),
      ...(replaced.length ? { replaced } : {}),
      // What the ingredients cost, in the `replaced` shape. This row is the
      // ONLY record of the spend now — a GM repairing a craft by hand reads
      // it here. A multi-turn project spent these when it STARTED and
      // carried the snapshot on CraftProject.consumed until now.
      ...(consumed?.length ? { consumed } : {}),
      ...extraDetails,
    },
  });
}

// --- The Death Mask (docs/tags.yaml `death-mask`) -------------------------
//
// The one recipe whose OUTPUT is named by an ingredient: the finished item is
// stamped with the dead character's name ("Death Mask of Ada"), read off the
// corpse it was cast over. The corpse is a group ingredient and so KEPT — but
// a face can only be cut once, so the craft marks the corpse's own
// description and refuses one already marked. The marker doubles as the
// fiction: Examine says the face is gone.
const DEATH_MASK_SLUG = "death-mask";
const FACE_TAKEN_SENTENCE = "The face has been taken.";

function maskNameFor(corpseName) {
  // "Ada's Corpse" → "Ada"; "Ada's Corpse (2)" → "Ada (2)"; the authored
  // monster corpses ("Graga Corpse") lose the bare word instead.
  const who = corpseName.replace(/'s Corpse\b/, "").replace(/ Corpse\b/, "").trim();
  return `Death Mask of ${who || "Nobody"}`;
}

// Which held corpse the mask is taken from. `ingredientChoice` carries the
// corpse tag's SLUG (the same channel an anyOf pick uses — a recipe has at
// most one of the two, so they cannot collide); a single unmarked corpse is
// taken as chosen, the dialog's one-option convention.
function resolveDeathMaskSource(character, ingredientChoice) {
  const corpses = character.tags.filter(
    (ct) => ct.tag?.group?.slug === "items-corpse",
  );
  if (!corpses.length) throw new UserError("Making that needs a corpse to hand.");
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

// Marks the corpse inside the craft transaction. Compare-and-swap on the
// exact description text, so two artists racing over one body cannot both
// take the face — the loser's write matches nothing and the craft refuses.
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

function payerNotice(character, payer, cost, tag) {
  if (payer.kind !== "character" || payer.id === character.id || !cost) return;
  notifyCharacter(
    payer,
    `${character.name} paid ${cost} ⬢ from your purse toward ${tag.name}.`,
  );
}

async function craftRequestImpl({
  tagId,
  quantity: rawQuantity,
  payerKey,
  // Which member of an `anyOf` ingredient goes in — a slug the dialog posts,
  // re-checked for membership and possession like everything else a client
  // sends.
  ingredientChoice,
  // The slugs a cook slotted, in order, on a recipe with `ingredientSlots`
  // (docs/systemdocs/COOKING.md). A separate channel from `ingredientChoice`
  // above because they answer different questions: that one picks a member of
  // a list the recipe named, this one is an ordered set out of a catalog the
  // recipe says nothing about. Re-checked here for membership, possession and
  // count, so the chip list is a hint like every other disabled control.
  ingredientChoices,
  // The custom-item fields (CRAFTING.md), honored only on a `customizable`
  // recipe. cleanCustomText decides what survives — the same shared helper
  // the dialog priced the +1 ⬢ with, so client and server cannot disagree
  // about whether a whitespace-only name counts.
  customName,
  customDescription,
  // The builder's line, honored only where placement.inscribable says so.
  inscription,
  // How many units the dialog TOLD the player would bill against their Move
  // (0 when it showed the craft as free). The server refuses to bill more
  // than was acknowledged: a stale tab whose free allowance ran out
  // elsewhere gets a retry, not a silent Move charge. "Declining crafts
  // nothing" is enforced here, not just in the confirm dialog.
  billedSeen: rawBilledSeen,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const tag = await loadRecipe(tagId);
  await requireRecipeSkills(character, tag);
  // Fieldwork is the one exemption from the forge: a recipe naming builder-*
  // skills otherwise demands Workshop Equipment in reach, which is right for
  // heavy works and wrong for stakes and drying racks.
  const placement = placementOf(tag);
  if (!placement?.fieldwork) await requireWorkshop(character, tag);
  // A `placement:` recipe is BUILT ON SITE and never lands on a sheet, so the
  // tag-tier gates below — prerequisites, exclusivity, tier replacement,
  // stacks — have nothing to say about it. It never carries ingredients
  // either; the sync refuses that pairing (db/lib/tagShapes.js).
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
  );
  // Ingredient slots, on top of `items` (COOKING.md). The legal set is every
  // tag carrying a `cooked` block, so it is read here rather than named on
  // the recipe — one query, narrowed to what was actually posted, and the
  // `cooked: { not: null }` is the membership check itself.
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
  // Just the tastes, for naming a dish nobody named (mintCustomCraft). Read
  // here because the mint runs outside the craft transaction and must not
  // open a query of its own.
  const cookedTastes = new Map(cookableRows.map((t) => [t.slug, t.cooked?.taste ?? ""]));
  const slotPlan = await resolveIngredientSlots(character, tag, quantity, posted, cookableBySlug);
  // One plan from here on: the ingredients a dish spends are spent the same
  // way, under the same lock, and land in the same `details.consumed`.
  //
  // MERGED BY TAG, not concatenated. No recipe today carries both an `items`
  // block and slots, but nothing stops one, and two entries naming the same
  // stack would have consumeRecipeItems draw against it twice off two
  // independent re-reads — the second refusal quoting a count nobody could
  // make sense of, and `details.consumed` showing two rows for one spend.
  for (const line of slotPlan.spend) {
    const existing = itemPlan.spend.find((s) => s.tagId === line.tagId);
    if (existing) existing.quantity += line.quantity;
    else itemPlan.spend.push(line);
  }
  const cookedFrom = slotPlan.cookedFrom;
  // The Death Mask binds a SPECIFIC corpse (the group entry above only
  // proved one is held) — resolved out here for the fast fail, marked
  // inside the transaction by takeFace.
  const deathMask =
    tag.slug === DEATH_MASK_SLUG
      ? resolveDeathMaskSource(character, ingredientChoice)
      : null;
  // The one shared verdict the dialog prices with (web/lib/customCraft.js):
  // what the words amount to after cleaning, and what this recipe charges for
  // them — usually CUSTOM_SURCHARGE, zero on the two meals, which buy them
  // out (COOKING.md). Fields posted against a non-customizable recipe, and a
  // description posted at a recipe that takes none, are dropped rather than
  // refused — the same posture as quantity on a non-stackable.
  //
  // `mayCustomize` is the second half of the gate and reads the rung the
  // recipe names (Tag.customizableSkillSlug — `smithing-skilled` on the arms
  // and armour), so an apprentice cannot sign a cudgel. The sheet already
  // hides the fields, but a sheet is a hint. Failing the rung drops the words
  // AND the surcharge: nobody pays for a name they did not get.
  const { custom: customWanted, surcharge: customSurcharge } = customCraftFor(tag, {
    customName,
    customDescription,
  });
  const mayCustom = mayCustomize(tag, heldSlugsOf(character.tags));
  const custom = mayCustom ? customWanted : { name: "", description: "", active: false };
  const surcharge = mayCustom ? customSurcharge : 0;
  const turns = tag.requirementTurns ?? 1;
  const cost = ((tag.requirementResources ?? 0) + surcharge) * quantity;
  const payer = await resolveCraftPayer(character, payerKey, cost);
  const openTurn = await getOpenTurn();

  // No Move of its own, but rationed per turn (docs/systemdocs/SMITHING.md §2):
  // a recipe's own `perTurn`, or the shared Dead Simple pool. Units PAST the
  // allowance are no longer refused — for a recipe with a craft family they
  // spill into the Move at 1/allowance each (CRAFTING.md §2a), which is what
  // makes a fifth work knife cost something rather than be impossible.
  //
  // Priced twice: here for a fast fail, and again inside the transaction under
  // the row lock, since two simultaneous requests would otherwise both read
  // the same count and pass.
  const perTurn = tag.requirementPerTurn ?? null;
  if (turns === 0) {
    const allowance = openTurn ? craftAllowance(tag) : null;
    const priceCraft = async (db) => {
      const already =
        allowance == null
          ? 0
          : perTurn != null
            ? await unitsOfTagThisTurn(db, character.id, openTurn.id, tag.id)
            : await deadSimpleUnitsThisTurn(db, character.id, openTurn.id);
      const priced = craftMoveCost(tag, {
        quantity,
        allowance,
        freeLeft: allowance == null ? null : allowance - already,
      });
      // No family to bill the overflow to (bone-mask is gated on `butcher`
      // alone), so the ration is still a wall.
      if (priced.kind === "capped") {
        throw new UserError(
          `You can only make ${allowance} ${tag.name} per turn (${already} already this turn).`,
        );
      }
      return priced;
    };
    const billedSeen = parseCount(rawBilledSeen, { min: 0, max: 99 }) ?? 0;
    // The player is never billed more than the dialog showed them. Priced
    // here for the fast fail, and AGAIN inside the transaction, where a
    // concurrent craft may have eaten the free allowance between the two —
    // the in-tx copy is what actually holds.
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
    // Minted before the transaction (see mintCustomCraft for why), unwound
    // after it only if the transaction fails and the row was fresh.
    //
    // A DISH ALWAYS MINTS, words or no words: what went in is what it does,
    // so it needs a row of its own even from a cook who named nothing. A meal
    // with no ingredient and no words has nothing to carry and stays the
    // plain catalog row, which keeps it Depot-listable and out of the way of
    // the Restart Game ephemeral sweep.
    const grant =
      custom.active || cookedFrom.length
        ? await mintCustomCraft(prisma, tag, { ...custom, cookedFrom, cookedTastes })
        : null;
    try {
    await prisma.$transaction(async (tx) => {
      // One lock for all the racy things: the ration counts, the ingredient
      // stacks, the grant re-check, and the Move ledger (spendCraftMove takes
      // it again, which costs nothing once this transaction holds it).
      if (allowance != null || itemPlan.spend.length || !tag.stackable) {
        await lockCharacter(tx, character.id);
      }
      const spend = await priceCraft(tx);
      acknowledgeBill(spend);
      let action = null;
      let budget = null;
      if (spend.kind === "spill") {
        // The fast fail only ran resolveCraftMove when the OUTSIDE price
        // already spilled, so a spill first seen here re-checks the Move
        // window itself — a craft submitted after Moves lock must not write
        // a ledger no matter how the race fell.
        if (moveCost.kind !== "spill") {
          const { locked } = moveWindow(openTurn, { clockFrozen: await clockFrozen(tx) });
          if (locked)
            throw new UserError("Moves are locked for this turn.");
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
    return { made: craftLabel(grant?.tag ?? tag, quantity) };
  }

  // Real work: this turn's Move, and a project if it takes more than one.
  //
  // Quantity is limited by WORK ARITHMETIC and nothing else (Chris
  // 2026-09-06): a unit costs its `turnsCost` of the Move — a whole turn,
  // or the 1/N a fractional recipe authors — so a brewer's Routine holds
  // three ⅓-turn Alcohol and a smith's holds ONE broadsword, and a spare
  // half-turn takes more same-family work or none. A project takes the Move
  // whole every turn it runs, so it can never share one — and it makes ONE
  // unit, its turns being per piece; wanting two means starting it twice.
  if (turns > 1 && quantity > 1) {
    throw new UserError(
      `That's ${turns} turns of work apiece — make them one at a time.`,
    );
  }
  const moveCost = craftMoveCost(tag, { quantity });
  // The cross-submission count — for a fractional recipe, `perTurn` holds
  // its work denominator, so this and the budget agree by construction.
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
  // A finishing craft mints now (outside the tx — mintCustomCraft says why);
  // a longer project carries the words on CraftProject.custom instead, and
  // continueCraftImpl mints them on the finishing turn. The Death Mask's
  // stamped name rides the same machinery in literal mode.
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
    // Ingredients go in when the work starts, the same moment the ⬢ do — and
    // like the ⬢ they never come back if the project is abandoned. A project
    // longer than a turn carries the snapshot on itself until it finishes.
    await lockCharacter(tx, character.id);
    await ration(tx);
    // The Move is claimed first: it is the contended thing, and a refusal
    // here rolls back everything below it.
    const { action, budget } = await spendCraftMove(tx, {
      character,
      openTurn,
      need: moveCost,
      entry: craftLedgerEntry(tag, moveCost),
      // A batch craft lets the Action's description be rebuilt from the
      // ledger; everything else keeps the line it has always written.
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
    // The face comes off when the work starts, like every other ingredient
    // cost — an abandoned mask still ruined the face, and no second cast
    // can ever be taken from this body.
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
    ? { made: craftLabel(grant?.tag ?? tag, quantity) }
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

// Another turn on a project. The recipe's gates are re-run: a skill lost
// since the start stops the work where it stands.
//
// The INGREDIENTS are not re-checked, and must not be — they were spent when
// the work started, so an honest continue would fail its own check on turn 2.
async function continueCraftImpl({ projectId }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  const project = await loadOwnProject(character, projectId);
  const tag = project.tag;
  await requireRecipeSkills(character, tag);
  await requireWorkshop(character, tag);
  const openTurn = await getOpenTurn();
  // A turn on a project is the whole Move, so it demands a clean one: any
  // fraction already spent on a batch craft blocks it, and it blocks
  // everything after it (docs/systemdocs/CRAFTING.md §2a).
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
  // The words stored when the work began (already cleaned then; cleaned
  // again here because re-sanitizing is free and stored JSON is still
  // input). Minted outside the tx — mintCustomCraft says why — and unwound
  // if the transaction fails.
  const pendingCustom =
    done && project.custom && typeof project.custom === "object"
      ? customCraftFields({
          customName: project.custom.name,
          customDescription: project.custom.description,
        })
      : { active: false };
  // A Death Mask project stamped its name (and source corpse) at start —
  // stored under its own key so customCraftFields above ignores it.
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
    ? { made: craftLabel(grant?.tag ?? tag, project.quantity) }
    : {
        continued: craftLabel(tag, project.quantity),
        turnsDone: next,
        turns: project.turnsNeeded,
      };
}

// Stopping keeps nothing: the ⬢ AND the ingredients went into materials when
// the work began, and neither comes back.
async function cancelCraftImpl({ projectId }) {
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

// --- Building (db/lib/structures.js) ----------------------------------
//
// A craftable whose Tag.placement is non-null is raised ON SITE instead of
// landing in a pocket. Costs are CREW-TURNS: `turnsCost` is the total number
// of person-turns, and anyone standing at the site can spend their daily Move
// advancing it. The recipe's skills gate OPENING a site, never joining one —
// a mason lays out the work, the labour is anybody's. The opener pays the
// whole resourceCost up front and never gets it back, the CraftProject rule.

// The ground, with everything canBuildHere() judges plus the channel the
// site speaks into.
async function loadBuildGround(locationId) {
  if (!locationId) return null;
  return prisma.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      name: true,
      // The site gate matches on this (placement.locations) — a Brewery
      // belongs at the inn and nowhere else.
      slug: true,
      indoors: true,
      attributes: true,
      discordChannelId: true,
      zone: { select: { kind: true } },
    },
  });
}

// Scenery into the Location's own channel, post-commit and catch-logged: a
// Discord outage must never roll back work that really happened
// (ARCHITECTURE.md §5).
function speakAtSite(channelId, line) {
  if (!channelId || !line) return;
  after(() =>
    postMessage(channelId, line).catch((err) =>
      console.error("Structure ambient line failed:", err),
    ),
  );
}

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
async function openBuildSiteImpl(
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
async function joinBuildSiteImpl({ structureId }) {
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
async function cancelBuildSiteImpl({ structureId }) {
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

// --- Lessons (docs/systemdocs/LESSONS.md) ------------------------------

// Learn and Teach are the same offer from opposite ends: the initiator's
// Move slot is checked now, both sides' when the other accepts. Nothing is
// filed until then — the offer row and one DM with two buttons.
async function lessonOfferImpl({ teacherId, learnerId, tagId }) {
  const { session, character } = await requireCharacter();
  const offer = await createLessonOffer(prisma, {
    initiatorId: character.id,
    teacherId,
    learnerId,
    tagId,
  });
  if (!offer.ok) throw new UserError(offer.reason);
  after(() =>
    sendDm(offer.dm.discordUserId, offer.dm.content, {
      components: offer.dm.components,
      meta: offer.dm.meta,
      source: "player_event",
    }).catch((err) =>
      console.error(`Lesson offer DM for ${offer.offer.id} failed:`, err),
    ),
  );
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_lesson_offer",
      targetCharacterId: offer.offer.responderId,
      details: { offerId: offer.offer.id, teacherId, learnerId, tagId },
    },
  });
  revalidateAll();
  return { pending: true };
}

async function learnRequestImpl({ teacherId, tagId }) {
  const { character } = await requireCharacter({ needs: ACT });
  return lessonOfferImpl({ teacherId, learnerId: character.id, tagId });
}

async function teachRequestImpl({ learnerId, tagId }) {
  const { character } = await requireCharacter({ needs: ACT });
  return lessonOfferImpl({ teacherId: character.id, learnerId, tagId });
}

// --- Confession (docs/systemdocs/CONFESSION.md) --------------------------

// Only the penitent has a door. The acting character is always the one
// confessing — taken from the session, never from the posted body — so there
// is no way to file a confession on somebody else's behalf, and no chaplain
// half of this to write. `chaplainId` and `tagId` are re-validated inside
// createConfessionOffer against the penitent's own row.
async function confessRequestImpl({ chaplainId, tagId }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  const offer = await createConfessionOffer(prisma, {
    penitentId: character.id,
    chaplainId,
    tagId,
  });
  if (!offer.ok) throw new UserError(offer.reason);
  after(() =>
    sendDm(offer.dm.discordUserId, offer.dm.content, {
      components: offer.dm.components,
      meta: offer.dm.meta,
      source: "player_event",
    }).catch((err) =>
      console.error(`Confession offer DM for ${offer.offer.id} failed:`, err),
    ),
  );
  // The audit row DOES name the tag. A GM has to be able to see what was
  // asked for; the chaplain is the one kept in the dark, not the host.
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_confession_offer",
      targetCharacterId: offer.offer.responderId,
      details: {
        offerId: offer.offer.id,
        chaplainId,
        penitentId: character.id,
        tagId,
      },
    },
  });
  revalidateAll();
  return { pending: true };
}

// --- Kiss (docs/systemdocs/KISS.md) --------------------------------------

// The one door. Every gate lives in db/lib/kiss.js#kissAuthority so the picker
// on the sheet, this action, and the Accept click a day later all refuse for
// the same reasons — and createKissOffer re-runs it rather than trusting
// anything that arrived in the body.
//
// The acting character comes from the session, never from a posted id, so
// there is no way to file a kiss on somebody else's behalf.
//
// No Move is spent and no Action row is filed. What holds it back is the
// 2-hour cooldown inside createKissOffer and the once-a-turn mood ration on
// the other side of Accept.
async function kissRequestImpl({ targetCharacterId }) {
  const { character } = await requireCharacter({ needs: ACT });

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    select: KISS_SELECT,
  });
  if (!target) throw new UserError(notHereMessage(target));

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  const offer = await createKissOffer(prisma, { actor: character, target, turn: openTurn });
  if (!offer.ok) throw new UserError(offer.reason);

  after(() =>
    sendDm(offer.dm.discordUserId, offer.dm.content, {
      components: offer.dm.components,
      meta: offer.dm.meta,
      source: "player_event",
    }).catch((err) => console.error(`Kiss offer DM to ${target.id} failed:`, err)),
  );

  // No audit row here on purpose. createKissOffer writes it inside the same
  // transaction as the Offer, because that row IS the two-hour cooldown
  // (db/lib/kiss.js#kissCooldownLeft) — a second one written here would just
  // be a duplicate, and leaving it to each caller is how a cooldown quietly
  // stops existing for whichever caller forgets.
  revalidateAll();
  return { pending: true };
}

// --- Tax -------------------------------------------------------------

// `picks` is { [characterId]: "amount" }, the StackRow shape. Every entry is
// re-derived from a fresh taxRoster() rather than trusted from the client —
// the picker may be stale, and a stale row is dropped rather than errored.
async function taxRequestImpl({ picks }) {
  const { character } = await requireCharacter({ needs: ACT });

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  // Identity-revealing, the same posture as any other act that names you —
  // a hooded Leader taxing in their own voice would be the unmasking tool
  // the concealment system otherwise refuses to be.
  if (character.concealed) throw new UserError("You can't tax anyone while concealed.");

  if (!character.tags.some((ct) => ct.tag?.slug === TAXMAN_SLUG)) {
    throw new UserError("You don't have a tax button.");
  }

  const { isOfficer, isLeader } = await getMyFactionRole(character.discordUserId, character.factionId);
  if (!isOfficer) throw new UserError("You're not a Leader or Treasurer.");
  const taxerRole = isLeader ? "Leader" : "Treasurer";

  const roster = await taxRoster(prisma, character, { openTurnNumber: openTurn.number });
  const byId = new Map(roster.map((m) => [m.id, m]));

  const entries = Object.entries(picks ?? {});
  const targets = [];
  for (const [characterId, rawAmount] of entries) {
    const member = byId.get(characterId);
    // Stale client state — dropped silently, not errored (§10 of TAGS.md's
    // metagaming posture: the roster is what decides, never the post body).
    if (!member || !member.sameZone || member.lockedOut) continue;
    const amount = Math.min(
      parseCount(rawAmount, { min: 1, max: member.resources }) ?? 0,
      member.resources,
    );
    if (amount <= 0) continue;
    targets.push({ id: member.id, amount });
  }
  if (targets.length === 0) throw new UserError("Nobody to tax.");

  // A duplicate row against the same target this turn would just double the
  // clamp math at close for no player-visible reason — refuse it here.
  const already = await prisma.pendingTax.findMany({
    where: { taxerId: character.id, turnId: openTurn.id, targetId: { in: targets.map((t) => t.id) }, declinedAt: null },
    select: { targetId: true },
  });
  const alreadyIds = new Set(already.map((r) => r.targetId));
  const filedTargets = targets.filter((t) => !alreadyIds.has(t.id));
  if (filedTargets.length === 0) throw new UserError("You've already taxed them this turn.");

  const targetRows = await prisma.character.findMany({
    where: { id: { in: filedTargets.map((t) => t.id) } },
    select: { id: true, name: true, discordUserId: true },
  });
  const withNames = filedTargets.map((t) => ({ ...t, ...targetRows.find((r) => r.id === t.id) }));

  const { dms } = await fileTax(prisma, {
    taxer: character,
    taxerRole,
    turn: openTurn,
    targets: withNames,
  });

  after(() =>
    Promise.all(
      dms.map((dm) =>
        sendDm(dm.discordUserId, dm.content, { components: dm.components, meta: dm.meta, source: "player_event" }).catch(
          (err) => console.error(`Tax DM failed:`, err),
        ),
      ),
    ),
  );

  revalidateAll();
  return { pending: true };
}

// --- Destroy -------------------------------------------------------------

// Drops an item you hold (`Tag.removable`, derived from the category in
// db/lib/syncTags.js). No refund and no ⬢ field: destroying is
// throwing away, and a cure is Heal's job (docs/systemdocs/TAGS.md §5).
async function destroyTagRequestImpl({
  tagId,
  quantity: rawQuantity,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const held = character.tags.find((ct) => ct.tagId === tagId);
  if (!held) throw new UserError("You don't have that tag.");
  if (!held.tag.removable)
    throw new UserError("That isn't something you can destroy.");

  const quantity = held.tag.stackable
    ? (parseCount(rawQuantity, { min: 1, max: held.quantity }) ?? 1)
    : held.quantity;

  const openTurn = await getOpenTurn();
  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity,
  };

  // Aftermath (Tag.removesInto) rolled up front so the transaction commits
  // exactly what the snapshot records. Fires once regardless of quantity.
  const aftermathSlugs = rollTagChain(held.tag.removesInto);

  let granted = [];
  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, tagId, quantity);
    granted = await grantTagSlugs(
      tx,
      character.id,
      aftermathSlugs,
      openTurn?.number ?? null,
    );
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_destroy_tag",
      targetCharacterId: character.id,
      details: {
        tagId,
        tagName: held.tag.name,
        quantity,
        granted: granted.map((g) => g.tagName),
        // The details blob is the only record now, so it carries what a GM
        // needs to put the tag back AS IT WAS rather than as a fresh grant.
        restore,
      },
    });
  });
  await afterInventoryChange(character.id);
  revalidateAll();
  return {};
}

// Consuming: the tag comes off and whatever Tag.consumesInto declares goes
// on. Always exactly ONE unit, so a stack feeds several times. No resource
// cost — the item already cost ⬢ to make. A grant may be conditional on
// what's already held, so the slug list runs through resolveConsumeGrants.
// Breaking a seal. Opening a letter is Consume because that is what it is —
// the seal is used up and cannot be put back — and routing it through the same
// button means a player never has to learn a second verb for it.
//
// Two things come out: the letter, exactly as it was written, and the spent
// envelope. The envelope is the point of the whole mechanism: it is evidence
// that somebody opened this, and whose wax was on it when they did.
async function breakSealRequestImpl({ session, character, held }) {
  const openTurn = await getOpenTurn();

  let opened;
  await prisma.$transaction(async (tx) => {
    opened = await breakSeal(tx, character.id, held.tag);

    const effect = {
      tagId: held.tagId,
      tagName: held.tag.name,
      // What the row is called NOW, so an Undo can find its way back.
      openedName: opened.paper.name,
      sealMark: held.tag.sealMark ?? null,
      envelopeTagId: opened.envelope?.id ?? null,
      envelopeName: opened.envelope?.name ?? null,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_break_seal",
      targetCharacterId: character.id,
      details: effect,
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { ok: true, name: opened.paper.name };
}

// Pointing the camera at nothing. The other thing you can do with an Instant
// Camera — 📸-reacting somebody's message is the real one, and that one is
// free (bot/src/events/messageReactionAdd.js). This path spends the camera and
// hands back a print of nobody.
//
// It takes its own road out of consumeTagRequestImpl for breakSeal's reason:
// the ordinary path reads `consumesInto`, which names CATALOG slugs, and a
// photo is a runtime row no slug in docs/tags.yaml can ever name.
async function photographNothingImpl({ session, character, held }) {
  const openTurn = await getOpenTurn();

  // The row is created BEFORE the transaction, because its name-collision
  // retry cannot survive inside one — Postgres aborts a transaction on the
  // first failed statement (db/lib/photoMint.js#createWithRetry). If the
  // transaction below then rolls back, the print is left in nobody's hands,
  // which reaches no browser and gets swept at the next Restart Game.
  const photo = await createBlankPhotoRow(prisma, character.id);

  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, held.tagId, 1);
    await attachPhoto(tx, character.id, photo);

    const effect = {
      tagId: held.tagId,
      tagName: held.tag.name,
      // Enough for an Undo to put the camera back and find the print again.
      restore: {
        tagId: held.tagId,
        source: held.source,
        expiresTurn: held.expiresTurn,
        quantity: 1,
      },
      photoTagId: photo.id,
      // The shape every other consumable files, so the GM desk's "Became" line
      // carries the print, and the
      // shared CONSUME_TAG undo takes it back out of their hands. `photoTagId`
      // above only tells that undo to delete the ROW as well, which is the one
      // thing a runtime print needs that a catalog grant does not.
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_consume_tag",
      targetCharacterId: character.id,
      // REQUESTS.md §1a — its sibling consume audit row carries this now
      // (review fix, round 3); this one was the one place it didn't.
      turnId: openTurn?.id ?? null,
      details: effect,
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { ok: true, name: photo.name };
}

// Cracking a crate — a Depot shipment, or one a player packed themselves
// (packageItemsRequestImpl). It used to be a button on /depot; it is a
// Consume now, which is both one verb fewer to learn and the only thing that
// made sense once a crate walked out of the landing pad and got carried
// somewhere else entirely. See docs/systemdocs/DEPOT.md §0e.
//
// A SEALED crate still wants the keycard, checked here rather than trusted
// from whatever surface offered the button.
//
// A crate's real contents live in `crateContents`, not `consumesInto`: the
// ordinary consume path resolves a grant through resolveConsumeGrants and
// grantTagSlugs, and grantTagSlugs knows nothing whatsoever about poison. A
// poisoned line item packed into a crate has to come back out poisoned
// (LAUNDERING CLASS, fix round M4), or packing it was a free bleach.
async function openCrateRequestImpl({ session, character, held }) {
  const crate = held.tag;
  const contents = Array.isArray(crate.crateContents) ? crate.crateContents : null;
  if (!contents) throw new UserError("That isn't a crate.");

  if (!canOpenCrate(crate, heldSlugsOf(character.tags))) {
    throw new UserError("It's sealed, and the lock wants a Depot Keycard.");
  }

  const openTurn = await getOpenTurn();
  const inner = await prisma.tag.findMany({ where: { id: { in: contents.map((c) => c.tagId) } } });
  const byId = new Map(inner.map((t) => [t.id, t]));

  // ⬢ ride the crate in the field the ordinary consume path already grants,
  // so nothing here has to know how the shipment was packed.
  const resourcesGranted = crate.consumesIntoResources ?? 0;

  const granted = [];
  // Contents that could not land — a non-stackable ware already held. Recorded
  // on the effect so the Ledger and a GM can see what the crate really gave.
  const skipped = [];
  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);
    // Double-fire guard (gate review): a crate is always quantity 1, and two
    // concurrent opens would otherwise both grant contents before the
    // second's own crate-row delete aborts the whole transaction on a raw
    // engine error. Same re-read-under-the-lock shape the poison actions
    // use, and the same refusal they give.
    const freshCrate = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId: held.tagId } },
    });
    if (!freshCrate || freshCrate.quantity < 1) {
      throw new UserError("You don't have that any more.");
    }
    for (const line of contents) {
      const tag = byId.get(line.tagId);
      // A ware pruned out of the catalog between landing and opening is gone.
      // Skipping it beats throwing: the rest of the crate should still open.
      if (!tag) continue;
      // addToStack returns the existing row untouched for a non-stackable tag
      // already held, so what the Ledger records has to be what actually
      // landed — not what the crate said it held. Otherwise a Merchant who
      // already owns an ML-23 opens a crate, receives nothing, and is told he
      // received a pistol.
      const before = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: character.id, tagId: tag.id } },
      });
      await addToStack(tx, character.id, tag.id, line.quantity, {
        source: "EVENT",
        stackable: tag.stackable,
        expiresTurn: await expiryForGrant(tx, tag, openTurn, {
          characterId: character.id,
          where: "openCrate",
        }),
        // The laundering fix itself: what packageItemsRequestImpl's own
        // manifest stored for this line, carried straight onto the landing
        // row. Absent (undefined) on a clean line, same as addToStack's own
        // no-poison default.
        poisonedCount: line.poisonedCount ?? 0,
        poisonPayload: line.poisonPayload ?? null,
      });
      const landed = tag.stackable ? line.quantity : before ? 0 : 1;
      if (landed > 0) granted.push({ tagId: tag.id, name: tag.name, quantity: landed });
      else skipped.push({ tagId: tag.id, name: tag.name, reason: "already held, and only one can be carried" });
    }

    if (resourcesGranted > 0) {
      await creditResources(
        tx,
        { kind: "character", id: character.id, name: character.name },
        resourcesGranted,
      );
    }

    await dropCharacterTag(tx, character.id, crate.id, null);

    const effect = {
      crateTagId: crate.id,
      crateName: crate.name,
      sealed: crate.sealedShipping,
      granted,
      skipped,
      resourcesGranted,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_crate_open",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: effect,
    });

    // The crate is a one-off catalog row and this was the last of it.
    const stillHeld = await tx.characterTag.count({ where: { tagId: crate.id } });
    const stillStashed = await tx.roomTag.count({ where: { tagId: crate.id } });
    if (stillHeld === 0 && stillStashed === 0) {
      await tx.tag.delete({ where: { id: crate.id } }).catch(() => {});
    }
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { granted, skipped, resourcesGranted };
}

async function consumeTagRequestImpl({ tagId, targetCharacterId }) {
  const { session, character } = await requireCharacter();

  const held = character.tags.find((ct) => ct.tagId === tagId);
  if (!held) throw new UserError("You don't have that tag.");
  if (!held.tag.consumable) throw new UserError("That tag can't be consumed.");

  // Breaking a seal takes its own road out of here. The ordinary consume path
  // below reads `consumesInto`, which names CATALOG SLUGS — and the letter
  // inside a sealed one is a runtime row that no slug in docs/tags.yaml can
  // ever name. See docs/systemdocs/PAPERWORK.md.
  if (held.tag.paperKind === "SEALED") {
    return breakSealRequestImpl({ session, character, held });
  }

  // Same reasoning, same road: an Instant Camera consumes into a runtime Photo
  // row rather than into anything the catalog can name.
  if (held.tag.slug === CAMERA_SLUG) {
    return photographNothingImpl({ session, character, held });
  }

  // And a crate, for the same reason again: what falls out of one is a list
  // of tag IDs printed on the crate at packing or landing, not catalog slugs,
  // and it also has a lock the ordinary path knows nothing about. Only for
  // opening it yourself — administering a crate to someone else is not a
  // thing (it has no `cures` and isn't `administerable`), so that case falls
  // through to the ordinary path below, which already refuses it with the
  // same message any other non-curative item gets.
  if (isCrate(held.tag) && (!targetCharacterId || targetCharacterId === character.id)) {
    return openCrateRequestImpl({ session, character, held });
  }

  // The Mulligan Potion is the one consumable that cannot be drunk from here:
  // it needs a name typed into it, so its road out is changeNameRequestImpl,
  // opened from the tag's own tooltip. Without this the generic path would
  // spend the bottle on nothing at all — it has no `consumesInto`.
  // MULLIGAN_SLUG is declared beside that function, further down this file.
  if (held.tag.slug === MULLIGAN_SLUG) {
    throw new UserError("Use the Mulligan button.");
  }

  // Two more that cannot be drunk from here, for the reason the Mulligan gives:
  // the generic path below reads `consumesInto`, and neither of these turns
  // into a tag at all. One asks who you are whispering to, the other where you
  // are going, so both come in through their own button on the Actions grid
  // and spend the bottle there. Without these branches the generic path would
  // swallow either one for nothing.
  if (held.tag.slug === RAVEN_DRAUGHT_SLUG) {
    throw new UserError("Use the Send Message button.");
  }
  if (held.tag.slug === STEPSTONE_SLUG) {
    throw new UserError("Use the Stepstone button.");
  }

  // Administerable: the item's `cures` intersects what a target holds, or
  // it's flagged `administerable` outright (Mercy, which cures nothing on a
  // list but stabilizes all the same) — never a bare force-feed. Hoisted
  // once here: the targeted-administer gate below and the cure-application
  // pass further down both read this same list, and used to compute it
  // twice.

  // A COOKED DISH (docs/systemdocs/COOKING.md) is the one consumable whose
  // effects are not written on its own row. It carries `cookedFrom` — the
  // ingredient slugs the cook slotted — and what it does is worked out from
  // those NOW, off the live catalog, rather than from a snapshot taken when
  // it was cooked. web/lib/cooking.js says why at length.
  //
  // findMany does not preserve the order it was asked for, and slot order is
  // what the taste sentence reads in, so the rows are put back in
  // `cookedFrom` order by hand. A slug that no longer resolves (an ingredient
  // pruned out of the catalog) is dropped rather than throwing: the dish is
  // already in somebody's hands and refusing to let them eat it would be the
  // worse answer.
  const cookedFrom = held.tag.cookedFrom ?? [];
  let ingredientTags = [];
  if (cookedFrom.length) {
    const rows = await prisma.tag.findMany({ where: { slug: { in: cookedFrom } } });
    const bySlug = new Map(rows.map((t) => [t.slug, t]));
    ingredientTags = cookedFrom.map((slug) => bySlug.get(slug)).filter(Boolean);
  }
  // ONE call, never one per ingredient: resolveConsumeGrants tracks what the
  // eater WILL hold across the list it is handed, which is how the drinking
  // ladder resolves against a rung the same swallow just granted. Two calls
  // would each resolve against a stale sheet and double-grant.
  const resolveAgainst = ingredientTags.length
    ? { ...held.tag, ...mergeDishGrants(held.tag, ingredientTags) }
    : held.tag;
  // What the dish CURES, unioned across the ingredients that opted in with
  // `cooked.cures: true` — a drunk tonic works in a stew, a dressing does
  // not. See web/lib/cooking.js#mergeDishCures and COOKING.md §5.
  const dishCures = mergeDishCures(held.tag, ingredientTags);

  // For a dish this is the INGREDIENTS' cure list, not the plate's — the
  // administerable gate below and the cure pass further down both read it.
  const curesList = dishCures.cures;

  // Administering to someone else (the medical pass, TAGS.md §5c): the item
  // leaves the ACTOR's hand, but every grant it makes — the cure below
  // included — lands on `target`, which defaults to the actor. Self-consume
  // is deliberately not ACT-gated (TAGS.md §5f); administering someone else
  // is, since it's an act done TO them rather than to your own sheet.
  const administered = Boolean(targetCharacterId) && targetCharacterId !== character.id;
  let target = character;
  if (administered) {
    const blocker = blockerFor(character.tags, ACT);
    if (blocker) {
      throw new UserError(`You can't do that right now. You're ${blocker.name}.`);
    }
    if (!character.locationId) {
      throw new UserError("You aren't anywhere you could treat someone.");
    }
    const found = await prisma.character.findFirst({
      where: { id: targetCharacterId, status: "ALIVE" },
      include: {
        // `resists` (M4): resolveConsumeGrants below needs the TARGET's own
        // resist-traits, administered or self — Iron Constitution shrugging
        // off a poison lands on whoever holds it, not whoever swallowed it.
        tags: { include: { tag: { select: { id: true, slug: true, name: true, resists: true } } } },
      },
    });
    if (!found || !isHere(character, found)) throw new UserError(notHereMessage(found));
    const targetSlugs = new Set(found.tags.map((ct) => ct.tag.slug));
    const intersects = curesList.some((slug) => targetSlugs.has(slug));
    if (!intersects && !held.tag.administerable) {
      throw new UserError(`${found.name} doesn't have anything that ${held.tag.name} can treat.`);
    }
    target = found;
  }

  const openTurn = await getOpenTurn();

  // administerSkill gates EVERY consume of the item — self included
  // (fitting a prosthetic needs medical-expert even on your own leg). A
  // different question from the ACT gate above, which self stays exempt
  // from and this never is — except here: this consume FILES A MOVE (below),
  // and a Bound or Paralyzed character cannot file one even for themselves
  // (review fix, M2). `administered`'s own ACT check above already covers
  // the targeted branch; self needs its own, checked only once (an
  // administered consume never reaches this un-ACT-gated by definition).
  //
  // M2 lands the fee: a gated consume also costs 1/2 Move from the medical
  // family (fitting is surgery, and the Expert's scarce Move is the fee —
  // this replaces any separate fitting ⬢). A synthetic tag prices the fixed
  // half, since the fee is a flat administer cost, never the ITEM's own
  // craft requirementTurns (Mercy's craft cost has nothing to do with
  // fitting it onto somebody). Priced and checked here for a fast fail, and
  // spent for real inside the transaction below, same as every other budget
  // craft. With no turn open there is nothing to bill and nothing to file —
  // same posture as a heal's priceHeal returning null — so the fee simply
  // does not apply rather than refusing "No turn is open."
  let administerMoveCost = null;
  if (held.tag.administerSkill) {
    const catalog = await prisma.tag.findMany({
      select: { id: true, slug: true, name: true, parentTagId: true },
    });
    const skillTag = catalog.find((t) => t.slug === held.tag.administerSkill);
    const ancestry = buildSkillAncestry(catalog);
    const satisfied = satisfiedSkillIds(character.tags.map((ct) => ct.tagId), ancestry);
    if (!skillTag || !satisfied.has(skillTag.id)) {
      throw new UserError(`You need ${skillTag?.name ?? "the right training"} to use ${held.tag.name}.`);
    }
    if (openTurn) {
      // The ACT gate belongs exactly here, not outside this branch (review
      // fix, round 3): it exists because filing the Move below is what a
      // Bound or Paralyzed character can't do even to themselves — self-
      // consume is otherwise ACT-exempt (TAGS.md §5f). With no turn open,
      // nothing files, so the gate has nothing to be about.
      if (!administered) {
        const blocker = blockerFor(character.tags, ACT);
        if (blocker) {
          throw new UserError(`You can't do that right now. You're ${blocker.name}.`);
        }
      }
      administerMoveCost = craftMoveCost(
        { requirementTurns: 1, requirementPerTurn: 2 },
        { quantity: 1, family: "medical" },
      );
      await resolveCraftMove(character, openTurn, administerMoveCost);
    }
  }

  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity: 1,
  };

  // The drinking ladder (docs/systemdocs/BREWING.md). Only status tags carry
  // an `escalatesInto`, so this is a handful of rows however big the catalog
  // gets — and it has to come from the CATALOG rather than from the tags this
  // character holds, because the walk needs the rungs ABOVE the one they are
  // standing on, which by definition they do not have yet.
  const ladderRows = await prisma.tag.findMany({
    where: { escalatesInto: { not: null } },
    select: { slug: true, escalatesInto: true },
  });
  const ladder = new Map(ladderRows.map((t) => [t.slug, t.escalatesInto]));

  // Iron Constitution's sidecar (M4): every `resists` slug the TARGET's own
  // held tags carry, so a grant that lands on that list shrugs off — the
  // trait is about the constitution swallowing it, not who administered it.
  const resistSlugs = resistSlugsOf(target.tags);


  const {
    slugs: grantSlugs,
    removes: climbedFrom,
    resisted: resistedSlugs,
    durations: grantDurations,
    resources: resourcesGranted,
  } = resolveConsumeGrants(resolveAgainst, heldSlugsOf(target.tags), ladder, resistSlugs);

  // The rungs the climb clears — Tipsy coming off as Wasted goes on. Built
  // INSIDE the transaction below, once the poisoned draw is known (fix
  // round, M4: the poison's own `removes` merges in there too) — snapshotted
  // the same way `cleared` normally is, so an Undo puts the drinker back
  // exactly where they were rather than leaving them Wasted with no Tipsy
  // underneath.

  // What this does to the dial (docs/systemdocs/MOOD.md), and the two rules
  // are different enough to be two functions.
  //
  // A DISH sums: its own small figure plus every ingredient's, harm and
  // relief kept apart so only the harm half is ever scaled. Saffron makes the
  // best thing in Ravenheart and feces the worst, and both are the
  // ingredient's doing rather than the recipe's.
  //
  // EVERYTHING ELSE takes the largest single figure, never a sum — Bliss is
  // one drink, and Sweets is a treat rather than a treat plus a meal.
  const isDish = ingredientTags.length > 0 || held.tag.mealMood != null;
  const moodTerms = isDish
    ? dishMoodTerms(held.tag.mealMood, ingredientTags.map((t) => t.cooked?.mood ?? 0))
    : null;
  const moodRelief = isDish ? 0 : consumeReliefFor(held.tag.slug, grantSlugs);

  // What the eater is told, and the only thing they are told: a dish names
  // its tastes and never its ingredients. `line` is returned to the client,
  // which prefers it over the generic "It used up." (noticeLines.js).
  const line = isDish ? tasteLine(ingredientTags.map((t) => t.cooked?.taste ?? "")) : null;

  // Cure application (the medical pass, TAGS.md §5c): every cured slug the
  // TARGET actually holds — not just the first, since one item (white-honey,
  // eventually) can cure several things a patient holds at once. `curesList`
  // itself was hoisted above, at the administer gate.
  const curedHeld = curesList.length
    ? target.tags.filter((ct) => curesList.includes(ct.tag.slug))
    : [];

  await prisma.$transaction(async (tx) => {
    // Deadlock avoidance (review fix, round 3): this transaction can lock
    // both the actor's row (the Move billing below) and the target's (the
    // patient-race re-check further down) — lock them in sorted-id order up
    // front, not actor-then-target, or two actors administering to each
    // other at the same instant lock in opposite orders and deadlock
    // (Postgres surfaces an unresolved cycle as a raw 40P01, not a
    // UserError).
    const lockIds =
      administered && target.id !== character.id
        ? [character.id, target.id].sort()
        : [character.id];
    for (const id of lockIds) await lockCharacter(tx, id);

    if (administerMoveCost) {
      // Re-checked here (review fix, round 3 — this was the one billed path
      // without an in-transaction window check): resolveCraftMove checked it
      // outside, but that read and this spend are not atomic with each
      // other, the same reasoning craftRequestImpl's spill path and
      // healCharacterRequestImpl's own in-tx checks already act on.
      const { locked } = moveWindow(openTurn, { clockFrozen: await clockFrozen(tx) });
      if (locked) throw new UserError("Moves are locked for this turn.");
      // The Move is claimed first: it is the contended thing, and a refusal
      // here rolls back everything below it (craftRequestImpl's project path
      // does the same).
      await spendCraftMove(tx, {
        character,
        openTurn,
        need: administerMoveCost,
        entry: craftLedgerEntry(held.tag, administerMoveCost),
      });
    }

    // Patient-side race (review fix, M2, same shape as
    // healCharacterRequestImpl's): two actors administering to the same
    // target in the same instant both pass the outside intersects gate,
    // both would spend ⬢ and (if administerSkill-gated) a Move fraction, and
    // dropCharacterTag on an already-gone row is a silent no-op — the loser
    // would look successful and cure nothing. The target row is already
    // locked, above; re-read its held tags under that lock before touching
    // them. Only re-verified when this item's own gate depended on the
    // intersection — an `administerable` item like Mercy has nothing to
    // lose by curing nothing, race or not, so it never refuses here.
    let curedHeldNow = curedHeld;
    if (administered) {
      const freshTags = await tx.characterTag.findMany({
        where: { characterId: target.id },
        select: {
          tagId: true,
          source: true,
          expiresTurn: true,
          quantity: true,
          tag: { select: { slug: true } },
        },
      });
      const freshSlugs = new Set(freshTags.map((ct) => ct.tag.slug));
      const stillIntersects = curesList.some((slug) => freshSlugs.has(slug));
      if (!stillIntersects && !held.tag.administerable) {
        throw new UserError(`${target.name} was already treated for that.`);
      }
      curedHeldNow = curesList.length
        ? freshTags.filter((ct) => curesList.includes(ct.tag.slug))
        : [];
    }

    // The poisoned-draw odds (M4): dropCharacterTag draws this specific unit
    // against the row's own poisonedCount/quantity as it stands right now,
    // under this same lock — a Consume of a stack the poisoner tainted is
    // exactly the hypergeometric draw a Transfer/Loot move uses, just at
    // quantity 1. A poisoned draw applies the POISON's own consumesInto on
    // top of the food's — resolved through the very same resolveConsumeGrants
    // (and the very same resists filter) rather than a second mechanism, so
    // Iron Constitution shrugs off a forced poison exactly like it shrugs off
    // a food's own grant.
    const { poisonedTaken, poisonPayload } = await dropCharacterTag(tx, character.id, tagId, 1);
    let poisonDraw = null;
    if (poisonedTaken > 0 && poisonPayload) {
      const poisonTag = await tx.tag.findUnique({
        where: { id: poisonPayload },
        select: {
          id: true,
          slug: true,
          name: true,
          consumesInto: true,
          consumesIntoUnless: true,
          consumesIntoDurations: true,
          consumesIntoOneOf: true,
          consumesIntoResources: true,
        },
      });
      if (poisonTag) {
        poisonDraw = {
          tag: poisonTag,
          grants: resolveConsumeGrants(poisonTag, heldSlugsOf(target.tags), ladder, resistSlugs),
        };
      }
    }
    const allGrantSlugs = poisonDraw ? [...grantSlugs, ...poisonDraw.grants.slugs] : grantSlugs;
    // A collision here is the food's own duration override against the
    // poison's — spread order means the POISON wins (it's applied last),
    // which is deliberate: a poison landing on top of a food grant is the
    // more dangerous half of the two, and its own timing should be the one
    // that sticks rather than getting silently overridden by whatever the
    // meal itself happened to specify for the same slug.
    const allGrantDurations = poisonDraw
      ? { ...grantDurations, ...poisonDraw.grants.durations }
      : grantDurations;
    const allResisted = poisonDraw ? [...resistedSlugs, ...poisonDraw.grants.resisted] : resistedSlugs;
    // Grant asymmetry (fix round, M4): the merge above used to drop the
    // poison's own `removes` (ladder rungs ITS consumesInto clears) and
    // `resources` (flat ⬢ it grants) on the floor — honored below, the same
    // way the food's own halves already are.
    const allClimbedFrom = poisonDraw ? [...climbedFrom, ...poisonDraw.grants.removes] : climbedFrom;
    const allResourcesGranted = resourcesGranted + (poisonDraw?.grants.resources ?? 0);

    const climbed = allClimbedFrom
      .map((slug) => target.tags.find((ct) => ct.tag.slug === slug))
      .filter(Boolean)
      .map((ct) => ({
        tagId: ct.tagId,
        tagName: ct.tag.name,
        source: ct.source,
        expiresTurn: ct.expiresTurn,
        quantity: 1,
      }));

    for (const rung of climbed) await dropCharacterTag(tx, target.id, rung.tagId, 1);
    const granted = await grantTagSlugs(
      tx,
      target.id,
      allGrantSlugs,
      openTurn?.number ?? null,
      allGrantDurations,
    );
    // The Resources half — Purse and Supply Kit (CAVING.md). Most
    // consumables grant none, so this is usually a no-op.
    if (allResourcesGranted) {
      await creditResources(
        tx,
        { kind: "character", id: target.id, name: target.name },
        allResourcesGranted,
      );
    }
    // db/lib/hiddenCures.js. Runs after the ordinary grants and records
    // nothing on the request, on purpose. A dish runs it for each INGREDIENT
    // too, so a pie made with leeches still takes the bruise off — the cure
    // is a property of the leeches, not of eating them whole.
    await applyHiddenCures(tx, target.id, held.tag.slug);
    for (const ing of ingredientTags) await applyHiddenCures(tx, target.id, ing.slug);
    if (moodTerms?.length) await applyMoodTerms(tx, target.id, moodTerms);
    else if (moodRelief) await applyMood(tx, target.id, { kind: "DRINK", base: moodRelief });

    // Per held cured tag: drop it, grant the aftermath (the item's own
    // `curesInto` override if it names this slug, else the cured tag's own
    // `removesInto` — same as an ordinary Heal), and ease half the wound's
    // mood cost. Re-read WITH group each time — the target load above omits
    // it, the same trap healCharacterRequestImpl already dodges, and
    // woundMoodFor needs it.
    const cured = [];
    for (const ct of curedHeldNow) {
      await dropCharacterTag(tx, target.id, ct.tagId);
      const curedTag = await tx.tag.findUnique({
        where: { id: ct.tagId },
        select: {
          slug: true,
          name: true,
          removesInto: true,
          requirementResources: true,
          requirementTurns: true,
          requirementPerTurn: true,
          requirementGambit: true,
          group: { select: { slug: true } },
        },
      });
      const override = dishCures.curesInto?.[curedTag.slug];
      const aftermathSlugs = override ? [override] : rollTagChain(curedTag.removesInto);
      const grantedAftermath = await grantTagSlugs(tx, target.id, aftermathSlugs, openTurn?.number ?? null);
      // woundMoodFor is signed (MOOD.md), hence the minus — the same
      // shape healCharacterRequestImpl uses.
      const relief = -woundMoodFor(curedTag) / 2;
      if (relief > 0) await applyMood(tx, target.id, { kind: "HEALED", base: relief });
      cured.push({
        tagId: ct.tagId,
        tagName: curedTag.name,
        aftermath: grantedAftermath.map((g) => g.tagName),
        restore: {
          tagId: ct.tagId,
          source: ct.source,
          expiresTurn: ct.expiresTurn,
          quantity: ct.quantity ?? 1,
        },
      });
    }
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_consume_tag",
      targetCharacterId: target.id,
      // REQUESTS.md §1a: a row a future ration might count must carry
      // turnId — this one already feeds routineHealsThisTurn-shaped counters
      // once administerSkill bills a Move (review fix, M2).
      turnId: openTurn?.id ?? null,
      details: {
        tagId,
        tagName: held.tag.name,
        restore,
        granted: granted.map((g) => g.tagName),
        resourcesGranted: allResourcesGranted,
        moodRelief: moodRelief || undefined,
        // The GM's copy of what a dish was, which is the only place the
        // ingredients are ever written down after the craft — the eater is
        // told the taste and nothing else.
        cookedFrom: cookedFrom.length ? cookedFrom : undefined,
        moodTerms: moodTerms?.length ? moodTerms : undefined,
        climbed: climbed.map((c) => c.tagName),
        cured: cured.length ? cured : undefined,
        administered: administered || undefined,
        targetName: administered ? target.name : undefined,
        // M4: what Iron Constitution shrugged off, and whether this draw came
        // up poisoned. The audit desk is a GM-only surface (web/app/(desk)/gm)
        // — this never rides along on a player-facing response.
        resisted: allResisted.length ? allResisted : undefined,
        poisoned: poisonDraw
          ? { poisonTagId: poisonDraw.tag.id, poisonName: poisonDraw.tag.name }
          : undefined,
      },
    });
  });
  await afterInventoryChange([character.id, administered ? target.id : null]);
  if (administered) {
    notifyCharacter(target, `${character.name} used ${held.tag.name} on you.`);
  }
  revalidateAll();
  // The taste sentence, which is the whole point of cooking — the one-click
  // Consume on the tag rail raises it too (COOKING.md §8).
  return line ? { line } : {};
}

// --- Poisoning (the medical pass, M4) ----------------------------------
//
// Dosing a meal or drink you're already holding. The poison-use dialog's
// other two options need no server logic of their own: drinking it yourself
// is the ordinary Consume path above (poisons are consumable, with a wired
// `consumesInto`), and dosing a helpless person is poisonCharacterRequestImpl
// below — its own deliberate door, not a loosening of the M1 medicine-
// administer gate, which stays cures-locked.
async function poisonItemRequestImpl({ poisonTagId, targetTagId }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const heldPoison = character.tags.find((ct) => ct.tagId === poisonTagId);
  if (!heldPoison) throw new UserError("You don't have that.");
  if (!heldPoison.tag.poison) throw new UserError("That isn't a poison.");

  const heldFood = character.tags.find((ct) => ct.tagId === targetTagId);
  if (!heldFood) throw new UserError("You don't have that.");
  if (!heldFood.tag.consumable || heldFood.tag.poison) {
    throw new UserError("That isn't something you can lace.");
  }
  // A food or drink, per the plan (items-food/items-drink) — not gear, not
  // the poison bottle itself (caught above), not a skill or a status.
  const foodGroup = heldFood.tag.group?.slug;
  if (foodGroup !== "items-food" && foodGroup !== "items-drink") {
    throw new UserError("That isn't something you can lace.");
  }

  const openTurn = await getOpenTurn();
  // THE ORACLE (fix round, M4): the refusals below used to fire for anyone,
  // which made lacing a stack a free, repeatable poison detector — the
  // dialog even advertised it (see poisonUse === "food"'s help text). Gated
  // on canDetectPoison now: a detector's own sense really would notice the
  // stack before committing the dose, so they keep the refusal (and the
  // vial); anyone else's dose is silently accepted and lost in the mix
  // instead of teaching them anything. Computed off the pre-transaction
  // snapshot like every other gate in this file — a trait or gadget held a
  // moment ago is not the kind of thing that changes mid-click.
  const canDetect = canDetectPoison(character.tags);

  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);
    // Double-fire (fix round, M4): re-verify the vial itself is still held
    // under the lock — dropCharacterTag below is a silent no-op on a gone
    // row, so without this a second tab could dose the same stack a second
    // time for free once the first tab's vial is already spent (the file's
    // own craftRequestImpl comments document this exact trap).
    const freshPoison = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId: poisonTagId } },
    });
    if (!freshPoison || freshPoison.quantity < 1) throw new UserError("You don't have that any more.");
    // Re-read the food's row fresh under the lock — the same patient-side
    // race shape consumeTagRequestImpl already guards: the stack may have
    // been eaten, transferred away, or already tainted between the load
    // above and this lock.
    const freshFood = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId: targetTagId } },
    });
    if (!freshFood) throw new UserError("You don't have that any more.");
    // Poisoner-side only (the plan is explicit): a poisoner learning their
    // OWN stack is already tainted with something else is acceptable — it's
    // never disclosed to whoever eventually eats it, and it never refuses on
    // the eating end (that would be the recipient-side leak the merge rule
    // below exists to avoid).
    const taintedDifferently = Boolean(
      freshFood.poisonPayload && freshFood.poisonPayload !== poisonTagId,
    );
    if (taintedDifferently && canDetect) {
      throw new UserError("That's already tainted with something else.");
    }
    // Over-lacing (fix round, M4): same gate as the oracle above. The stack
    // is already fully poisoned, so one more dose has nowhere to land — a
    // detector is told outright and keeps the vial; anyone else just wastes
    // it, same silent-loss shape as dosing a differently-tainted stack.
    const stackFull = freshFood.poisonedCount > 0 && freshFood.poisonedCount >= freshFood.quantity;
    if (stackFull && !taintedDifferently && canDetect) {
      throw new UserError("It can't hold any more poison than that.");
    }
    const wasted = taintedDifferently || (stackFull && !taintedDifferently);
    const poisonedCount = wasted
      ? freshFood.poisonedCount
      : Math.min(freshFood.poisonedCount + 1, freshFood.quantity);
    if (!wasted) {
      await tx.characterTag.update({
        where: { id: freshFood.id },
        data: { poisonedCount, poisonPayload: poisonTagId },
      });
    }
    await dropCharacterTag(tx, character.id, poisonTagId, 1);
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_poison_item",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: {
        poisonTagId,
        poisonName: heldPoison.tag.name,
        foodTagId: targetTagId,
        foodName: heldFood.tag.name,
        poisonedCount,
        quantity: freshFood.quantity,
        // GM-only detail (see the audit-desk comment on consumeTagRequestImpl's
        // own `poisoned` field) — never surfaced to the actor, whose own
        // response is identical whether this landed or was silently lost.
        wasted: wasted || undefined,
      },
    });
  });

  await afterInventoryChange(character.id);
  revalidateAll();
  return {};
}

// Dosing a helpless person standing here. Poison's own deliberate door
// (Chris, 2026-09-08): the target must be in INCAPACITATING_SLUGS (bound,
// dying, paralyzed, unconscious, crucified, catatonic — the same class
// HARM/LOOT use) and co-located; a conscious victim is never dosable this
// way, which is exactly what poisoned food is for. Grants land through the
// same resolveConsumeGrants the Consume path uses, resists filter included,
// so a forced dose is countered by Iron Constitution exactly like a
// swallowed one — the trait is about the constitution, not the consent.
async function poisonCharacterRequestImpl({ poisonTagId, targetCharacterId }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const heldPoison = character.tags.find((ct) => ct.tagId === poisonTagId);
  if (!heldPoison) throw new UserError("You don't have that.");
  if (!heldPoison.tag.poison) throw new UserError("That isn't a poison.");

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id)
    throw new UserError("Pick someone else.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    include: {
      tags: { include: { tag: { select: { id: true, slug: true, name: true, resists: true } } } },
    },
  });
  if (!target || !isHere(character, target))
    throw new UserError(notHereMessage(target));

  const heldSlugs = new Set(target.tags.map((ct) => ct.tag.slug));
  if (![...heldSlugs].some((slug) => INCAPACITATING_SLUGS.has(slug))) {
    throw new UserError(
      "You can't poison a conscious, able person.",
    );
  }

  const openTurn = await getOpenTurn();
  const resistSlugs = resistSlugsOf(target.tags);
  // No ladder walk here, unlike Consume's: every catalog item with
  // `poison: true` is a status vial, never a drinking-ladder rung, so the
  // extra query the ordinary Consume path always pays for would resolve
  // nothing. Caveat: that is a fact about today's catalog, not something
  // this call enforces — if a future poison's own consumesInto ever named a
  // slug that IS a ladder rung, passing `null` here would silently skip the
  // climb (consumeGrants.js's own comment on this same assumption).
  const grants = resolveConsumeGrants(heldPoison.tag, heldSlugsOf(target.tags), null, resistSlugs);

  await prisma.$transaction(async (tx) => {
    // Deadlock avoidance, same shape as consumeTagRequestImpl's administered
    // branch: lock in sorted-id order, never actor-then-target.
    const lockIds = [character.id, target.id].sort();
    for (const id of lockIds) await lockCharacter(tx, id);

    // Double-fire (fix round, M4): re-verify the vial itself is still held
    // under the lock, same reasoning as poisonItemRequestImpl's own re-check
    // — dropCharacterTag below is a silent no-op on a gone row, so two tabs
    // firing at once would otherwise force two doses out of one vial.
    const freshPoison = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId: poisonTagId } },
    });
    if (!freshPoison || freshPoison.quantity < 1) throw new UserError("You don't have that any more.");

    // Patient-side race: re-verify helplessness under the lock. Somebody
    // could have freed, healed or revived them between the load above and
    // this lock.
    const freshTags = await tx.characterTag.findMany({
      where: { characterId: target.id },
      select: { tag: { select: { slug: true } } },
    });
    const freshSlugs = new Set(freshTags.map((ct) => ct.tag.slug));
    if (![...freshSlugs].some((slug) => INCAPACITATING_SLUGS.has(slug))) {
      throw new UserError("They're no longer helpless.");
    }

    await dropCharacterTag(tx, character.id, poisonTagId, 1);
    const granted = await grantTagSlugs(
      tx,
      target.id,
      grants.slugs,
      openTurn?.number ?? null,
      grants.durations,
    );
    if (grants.resources) {
      await creditResources(
        tx,
        { kind: "character", id: target.id, name: target.name },
        grants.resources,
      );
    }
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_poison_character",
      targetCharacterId: target.id,
      turnId: openTurn?.id ?? null,
      details: {
        poisonTagId,
        poisonName: heldPoison.tag.name,
        targetName: target.name,
        granted: granted.map((g) => g.tagName),
        resisted: grants.resisted.length ? grants.resisted : undefined,
      },
    });
  });

  await afterInventoryChange([character.id, target.id]);
  // Anonymous, same posture as harmCharacterRequestImpl's "Someone hurt
  // you." — the target learns something happened, not who did it. What
  // actually landed is right there on their sheet once they can read it
  // again.
  notifyCharacter(target, "Someone forced something down your throat.");
  revalidateAll();
  return {};
}

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

// "hood:<token>" -> "character:<id>", or the key untouched. Null when the
// token names nobody standing here, which resolveParty then refuses as an
// unknown party — the same answer a made-up id gets.
async function hoodedKey(character, key) {
  const raw = String(key ?? "");
  if (!raw.startsWith("hood:")) return raw;
  const id = await resolveHoodToken(prisma, character, raw.slice("hood:".length));
  return id ? `character:${id}` : "";
}

async function transferRequestImpl({
  fromKey,
  toKey,
  tags: rawTags,
  amount: rawAmount,
}) {
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
  // (db/lib/whosHere.js). resolveHoodToken re-checks co-presence itself and
  // answers null for a token minted in a room this character has since left.
  const [fromResolved, toResolved] = await Promise.all([
    hoodedKey(character, fromKey),
    hoodedKey(character, toKey),
  ]);
  // `allowDead` on the SOURCE only: taking things off a corpse is the whole
  // point of a loot-shaped transfer, while handing something TO a body is not
  // a thing. Loot resolves its target the same way.
  const [from, to] = await Promise.all([
    resolveParty(fromResolved, { allowDead: true }),
    resolveParty(toResolved),
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
  // room adds "and its door opens for you".
  //
  // The one asymmetry: `direction` lets a member DEPOSIT into their own
  // faction's silo from anywhere in that room's zone, while taking anything
  // back out keeps the strict rule (web/lib/transferReach.js).
  const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
  for (const [direction, party] of [
    ["from", from],
    ["to", to],
  ]) {
    if (!(await canReachParty(character, party, { heldSlugs, direction, allowConcealed: true }))) {
      // Only to pick which of the two out-of-reach sentences to write —
      // the same predicate the gate itself used, not a second one.
      const isSilo =
        party.kind === "room" && (await isOwnFactionSilo(character, party));
      throw new UserError(outOfReachMessage(party, { isSilo }));
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
      select: {
        resources: true,
        tags: { select: { quantity: true, equipped: true, tag: true } },
      },
    });
    const config = await prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: { carryWeightLbs: true, carryResourceCap: true },
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
    turnPhase: openTurn?.phase ?? null,
    note: null,
  };
  const fromParty = { kind: from.kind, id: from.id, name: from.name };
  const toParty = { kind: to.kind, id: to.id, name: to.name };
  // Two fields the silo ledger reads back (FACTIONS.md §4c), and the reason
  // both are written HERE rather than resolved when the ledger is drawn.
  //
  // `by` is the name the room saw, frozen the way ArchiveEntry.concealedAlias
  // is: resolving it live would unmask every deposit somebody ever made the
  // moment the hood came off. No extra query — requireCharacter already loads
  // whole Tag rows with `equipped`, which is all forcedNameFrom and
  // concealmentFrom read.
  //
  // `moveId` ties one act together. This writes one audit row per tag stack
  // plus one for the ⬢, so handing in two stacks and 30 ⬢ is three rows; the
  // ledger groups on this to print it as the one thing it was.
  const by = presentedIdentity(character, {
    forcedName: forcedNameFrom(character.tags),
    concealment: concealmentFrom(character.tags),
  }).name;
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
        await applyTransfer(tx, { from, to, amount, ledger });
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
      `You were handed ${goods}.`,
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
  if (from.kind === "room")
    after(() => announceInRoom(from, character, `takes ${goods}.`));

  revalidateAll();
  return {};
}

// --- Healing ----------------------------------------------------------

// Treating someone else's affliction — the only request whose subject isn't
// the filer, so most ids below are the TARGET's. Three gates, all
// re-checked here: the medic holds a Medical skill, the patient is standing
// here (web/lib/peopleHere.js), and the affliction's own requirementSkills
// are satisfied. The PAYER is ungated beyond being here, same bet as Craft.
async function healCharacterRequestImpl({
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
            // Lucky keeps the better of two dice (db/lib/advantage.js).
            diceRoll: rollWithAdvantage(character.tags).die,
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

// --- Research (Scholastic skill, docs/tags.yaml `research`) -------------
//
// Studying a held ingredient in the Cathedral's library. Filed exactly like
// the heal Gambit above — CONFIRMED, `moveKind: GAMBIT`, the die already
// rolled and stored, `moveReviewStatus: OPEN` — but for a different reason.
// A gambit heal sits OPEN because a GM reads it and writes the cure by hand
// (docs/systemdocs/TAGS.md §5c). Nobody adjudicates a research roll: it sits
// OPEN because it hasn't been RESOLVED yet, the same posture a Lesson Gambit
// takes (db/lib/lessons.js) — db/lib/researchPass.js reads `gmNotes` back at
// turn close, in its own pass between Lessons and Confessions, and writes
// the paper (or the "nothing" line) and the SOLVED status itself. Which
// ingredient was chosen has nowhere else to live: the Action has one
// `description` and no ingredient column, so `researchMarker()` stamps the
// slug into `gmNotes`, the same channel Craft's `auto:craft` marker and the
// Death Mask's corpse choice both ride.
//
// No file-time DM: the confirm prompt already told the player this spends
// the Move as a Gambit whose result lands at turn close (the sheet's own
// dialogs never echo that back the way Play's Move panel does — heal's
// Gambit branch above sends nothing to the medic either, only to a target
// who is someone else).
async function researchRequestImpl({ ingredientSlug }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.tags.some((ct) => ct.tag?.slug === RESEARCH_TAG_SLUG))
    throw new UserError("You don't know how to research.");

  // No `character.location` on the shared include (requireCharacter is every
  // request's loader) — a targeted read off the scalar FK, the same shape
  // db/lib/mood.js#applyArrivalMood uses for its own Cathedral check.
  const location = character.locationId
    ? await prisma.location.findUnique({
        where: { id: character.locationId },
        select: { slug: true },
      })
    : null;
  if (location?.slug !== CATHEDRAL_LOCATION_SLUG)
    throw new UserError("You must be located in the Cathedral to Research.");

  const catalog = await loadResearchCatalog(prisma);
  const held = researchableHeld(character.tags, catalog);
  const ingredient = held.find((ct) => ct.tag?.slug === ingredientSlug);
  if (!ingredient) throw new UserError("You aren't carrying that.");

  const openTurn = await getOpenTurn();
  // requireFreeMove is also the Move-window check (web/lib/moveSpend.js) —
  // no separate `moveWindow` read is needed the way craft's fractional Move
  // needs one, because a Gambit always takes the whole thing.
  await requireFreeMove(character, openTurn);

  let action;
  await prisma.$transaction(async (tx) => {
    // The P2002 catch below is the real gate — @@unique([characterId,
    // turnId]) — but requireFreeMove's read a moment ago is what keeps a
    // normal submit from ever reaching it.
    try {
      action = await tx.action.create({
        data: {
          characterId: character.id,
          turnId: openTurn.id,
          type: "MOVE",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          moveKind: "GAMBIT",
          moveReviewStatus: "OPEN",
          description: `Researching ${ingredient.tag.name} in the Cathedral.`,
          // Lucky keeps the better of two dice (db/lib/advantage.js).
          diceRoll: rollWithAdvantage(character.tags).die,
          diceModifier: gambitModifierTotal(character.tags, {
            hungerStreak: character.hungerStreak,
            mood: character.mood,
          }),
          zoneId: character.zoneId ?? null,
          locationId: character.locationId ?? null,
          gmNotes: researchMarker(ingredientSlug),
        },
      });
    } catch (err) {
      if (err?.code === "P2002")
        throw new UserError("You've already used your Move this turn.");
      throw err;
    }

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "research_filed",
      targetCharacterId: character.id,
      turnId: openTurn.id,
      details: { ingredientSlug },
    });
  });

  revalidateAll();
  return { ingredientName: ingredient.tag.name };
}

// --- Looting a living, incapacitated target ----------------------------

// A helpless target (dying/catatonic/paralyzed/bound) is lootable the same
// way a corpse is; this handles both in one request, tags AND ⬢ together.
// The older TRANSFER_TAG/TRANSFER_RESOURCES LOOT direction still exists so
// old Request rows undo correctly, but nothing files one any more.
async function lootCharacterRequestImpl({
  targetCharacterId,
  tagPicks: rawTagPicks,
  amount: rawAmount,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: { in: ["ALIVE", "DEAD"] } },
    include: {
      tags: {
        include: {
          tag: {
            select: {
              name: true,
              category: true,
              stackable: true,
              slug: true,
              tradeable: true,
            },
          },
        },
      },
    },
  });
  if (target?.buriedAt) throw new UserError("They're already in the ground.");
  if (!target || !isHere(character, target, { allowDead: true }))
    throw new UserError(notHereMessage(target));

  // A corpse needs no further excuse; a living target has to be helpless —
  // otherwise it's a Gambit for a GM to adjudicate.
  const incapacitated =
    target.status === "DEAD" ||
    target.tags.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug));
  if (!incapacitated)
    throw new UserError("They aren't in any state to be looted.");

  const picks = Array.isArray(rawTagPicks) ? rawTagPicks : [];
  const amount = parseCount(rawAmount, { min: 0 }) ?? 0;
  if (!picks.length && amount <= 0)
    throw new UserError("Pick something to take.");

  const takenTags = [];
  for (const pick of picks) {
    const held = target.tags.find((ct) => ct.tagId === pick.tagId);
    if (!held || !isTradeable(held.tag)) {
      throw new UserError("That isn't something you can take off a body.");
    }
    const quantity = held.tag.stackable
      ? (parseCount(pick.quantity, { min: 1, max: held.quantity }) ?? null)
      : held.quantity;
    if (quantity == null)
      throw new UserError(`Bad quantity for ${held.tag.name}.`);
    takenTags.push({
      tagId: held.tagId,
      tagName: held.tag.name,
      quantity,
      source: held.source,
      expiresTurn: held.expiresTurn,
      stackable: held.tag.stackable,
    });
  }

  if (amount > target.resources)
    throw new UserError(`${target.name} only has ${target.resources} ⬢.`);

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    // Loot lock (fix round M4b, fix 3): unlike Transfer and Heal, this used
    // to take no lock at all — two looters racing the same helpless target
    // would both run dropCharacterTag's absolute writes against the same
    // unlocked stack (duplicated units, or a poisoned split counted twice).
    // Same sorted-id lock the heal and poison paths use, for the same
    // deadlock-avoidance reason (a simultaneous cross-loot would otherwise
    // lock actor-then-target and target-then-actor at once).
    const lockIds = [character.id, target.id].sort();
    for (const id of lockIds) await lockCharacter(tx, id);

    // Race re-check under the lock: `takenTags`/`amount` were priced against
    // a read taken before the lock, so a concurrent loot (or anything else
    // that shrank the target's stack or purse since) needs a fresh look
    // before anything is actually taken. Refusing beats granting the SECOND
    // looter the full originally-requested amount regardless of what the
    // body still has — dropCharacterTag quietly takes less (or nothing) off
    // a shrunk row, but this loop would otherwise still hand the requester
    // the untouched request quantity.
    for (const t of takenTags) {
      const freshHeld = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: target.id, tagId: t.tagId } },
      });
      if (!freshHeld || freshHeld.quantity < t.quantity) {
        throw new UserError(`Someone already took that.`);
      }
    }
    let freshResources = target.resources;
    if (amount > 0) {
      const freshTarget = await tx.character.findUnique({
        where: { id: target.id },
        select: { resources: true },
      });
      freshResources = freshTarget?.resources ?? 0;
      if (freshResources < amount) {
        throw new UserError(`${target.name} only has ${freshResources} ⬢ left.`);
      }
    }

    for (const t of takenTags) {
      // Same poison hand-off as Transfer (M4): a body's held stack draws its
      // poisoned units proportionally, and they land on the looter under the
      // same "poisons don't mix" dilution addToStack enforces.
      const { poisonedTaken, poisonPayload } = await dropCharacterTag(tx, target.id, t.tagId, t.quantity);
      await addToStack(tx, character.id, t.tagId, t.quantity, {
        source: "EVENT",
        expiresTurn: t.expiresTurn,
        stackable: t.stackable,
        poisonedCount: poisonedTaken,
        poisonPayload,
      });
    }
    if (amount > 0) {
      await moveResources(tx, { kind: "character", id: target.id }, -amount);
      await moveResources(tx, { kind: "character", id: character.id }, amount);
    }

    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      targetStatus: target.status,
      tags: takenTags.map((t) => ({
        tagId: t.tagId,
        tagName: t.tagName,
        quantity: t.quantity,
        source: t.source,
        expiresTurn: t.expiresTurn,
      })),
      amount,
    };
    // Waking up robbed is frightening; a corpse minds nothing (MOOD.md).
    if (target.status === "ALIVE") await applyMood(tx, target.id, { kind: "ROBBED" });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_loot_character",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  // The looter's carry caps and doors, and the target's if they're alive (a
  // corpse holds nothing that needs settling).
  await afterInventoryChange([
    character.id,
    target.status === "ALIVE" ? target.id : null,
  ]);

  const lootParts = [
    ...takenTags.map((t) => formatStack(t.tagName, t.quantity)),
    amount > 0 ? `${amount} ⬢` : null,
  ].filter(Boolean);
  if (lootParts.length)
    notifyCharacter(
      target,
      `Your body was searched: ${lootParts.join(", ")} taken.`,
    );

  revalidateAll();
  return {};
}

// --- Moving another character: GONE ------------------------------------
//
// MOVE_CHARACTER shoved one person one hop for free, with no consent and no
// record beyond an audit row, and it duplicated the drag picker's predicate
// word for word. Both are replaced by escorting: you attach somebody once and
// they follow you, the helpless without asking and everyone else through an
// Offer. db/lib/escort.js is the one authority now, and the party rack on
// /chat is the surface. See docs/systemdocs/MAP.md §3a.

// --- Binding and freeing -------------------------------------------------

// Nothing else grants `bound`, and it's the one incapacitating state a
// player can inflict on purpose. Two doors (db/lib/bind.js): someone who
// can't stop you — dead, or already helpless — is bound on the spot; anyone
// else has to agree, so the target gets a DM with Accept / Decline and the
// request fires only on Accept (docs/systemdocs/LESSONS.md).
async function bindCharacterRequestImpl({
  targetCharacterId,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id)
    throw new UserError("You can't bind yourself.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: { in: ["ALIVE", "DEAD"] } },
    select: BIND_SELECT,
  });
  if (!target || !isHere(character, target, { allowDead: true }))
    throw new UserError(notHereMessage(target));
  if (isBoundTarget(target))
    throw new UserError(`${target.name} is already bound.`);

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  const actor = {
    id: character.id,
    name: character.name,
    discordUserId: session.discordUserId,
  };

  if (!needsNoConsent(target)) {
    const offer = await createBindOffer(prisma, {
      actor,
      target,
      turn: openTurn,
    });
    if (!offer.ok) throw new UserError(offer.reason);
    after(() =>
      sendDm(offer.dm.discordUserId, offer.dm.content, {
        components: offer.dm.components,
        meta: offer.dm.meta,
        source: "player_event",
      }).catch((err) =>
        console.error(`Bind offer DM to ${target.id} failed:`, err),
      ),
    );
    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_bind_offer",
        targetCharacterId: target.id,
        details: { offerId: offer.offer.id, targetName: target.name },
      },
    });
    revalidateAll();
    return { pending: true, name: target.name };
  }

  await applyBind(prisma, { actor, target, turn: openTurn });
  await afterInventoryChange(target.id);
  notifyCharacter(target, "Someone bound you.");
  revalidateAll();
  return {};
}

// The rescue half — anyone standing there may cut someone loose.
async function freeCharacterRequestImpl({
  targetCharacterId,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");

  const bound = await requireBoundTag(prisma);
  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    include: { tags: { where: { tagId: bound.id } } },
  });
  if (!target || !isHere(character, target))
    throw new UserError(notHereMessage(target));

  const held = target.tags[0];
  if (!held) throw new UserError(`${target.name} isn't bound.`);

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, target.id, bound.id);
    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tagId: bound.id,
      tagName: bound.name,
      quantity: held.quantity,
      source: held.source,
      expiresTurn: held.expiresTurn,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_free_character",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  await afterInventoryChange(target.id);
  notifyCharacter(target, "Someone freed you.");
  revalidateAll();
  return {};
}

// --- Crucifixion -----------------------------------------------------------

const CRUCIFIX_SLUG = "crucifix";
const CRUCIFIED_SLUG = "crucified";
const FUNDAMENTALIST_SLUG = "fundamentalist";

// Nailing someone to the cross. Three gates and no consent: the actor is a
// Fundamentalist, a COMPLETE Cross stands where they are (a half-built or
// damaged one is not a cross), and the target is standing there too. Free
// like Bind — it spends no Move — and it kills on a clock rather than on the
// spot: `crucified` becomes Dying at the close of this turn, and the Dying
// pass kills at the next (docs/tags.yaml, db/lib/dyingDeathPass.js). A GM
// Undo within the turn takes them down; after the close there is only Dying
// left to heal, and Undo says so.
//
// The ambient line names the VICTIM and never the actor. notifyCharacter's
// no-attribution rule is about not telling a helpless target who did it; a
// crucifixion is a public example, and an anonymous one is scenery about
// nothing.
async function crucifyCharacterRequestImpl({
  targetCharacterId,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id)
    throw new UserError("You can't crucify yourself.");
  if (!character.tags.some((ct) => ct.tag.slug === FUNDAMENTALIST_SLUG))
    throw new UserError("Only a Fundamentalist would.");

  const location = await loadBuildGround(character.locationId);
  const standing = await structuresAt(prisma, character.locationId, {
    statuses: ["COMPLETE"],
  });
  const cross = standing.find((s) => s.typeSlug === CRUCIFIX_SLUG) ?? null;
  if (!cross) throw new UserError("There is no cross standing here.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    select: {
      id: true,
      name: true,
      status: true,
      locationId: true,
      concealed: true,
      discordUserId: true,
      tags: { select: { tag: { select: { slug: true } } } },
    },
  });
  if (!target || !isHere(character, target))
    throw new UserError(notHereMessage(target));
  if (target.tags.some((ct) => ct.tag.slug === CRUCIFIED_SLUG))
    throw new UserError(`${target.name} is already on the cross.`);

  const crucified = await prisma.tag.findUnique({
    where: { slug: CRUCIFIED_SLUG },
  });
  if (!crucified)
    throw new UserError("The Crucified tag is missing from the catalog — tell a GM.");

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");
  const expiresTurn = await expiryForGrant(prisma, crucified, openTurn);

  const effect = {
    targetCharacterId: target.id,
    targetName: target.name,
    tagId: crucified.id,
    tagName: crucified.name,
    expiresTurn,
    structureId: cross.id,
    locationId: location?.id ?? character.locationId,
    locationName: location?.name ?? null,
  };
  await prisma.$transaction(async (tx) => {
    await addToStack(tx, target.id, crucified.id, 1, {
      source: "EVENT",
      expiresTurn,
      stackable: crucified.stackable,
    });
    // The single most frightening thing that can happen to a person (MOOD.md).
    await applyMood(tx, target.id, { kind: "CRUCIFIED" });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_crucify_character",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  await afterInventoryChange(target.id);
  notifyCharacter(target, "You've been put on the cross.");
  speakAtSite(
    location?.discordChannelId,
    ambientLine(`${target.name} hangs on the cross.`),
  );
  revalidateAll();
  return { name: target.name };
}

// --- Torture (docs/systemdocs/TORTURE.md) ----------------------------------

// A Torturer works on somebody who is already Bound and standing here. One die,
// resolved on the spot: a break DMs the torturer everything on the sheet that
// isn't a wound or a passing status, plus the last three Desires fulfilled,
// and the Depressed tag lands on the victim. Either way the victim takes the
// TORTURED mood hit and the torturer's Move is spent. The die and its
// arithmetic live in db/lib/torture.js; this file only loads rows and writes.
//
// Filed as a ROUTINE already PASSED (fileAutoRoutine) rather than a Gambit:
// the torturer is told immediately, and a Gambit row would have the turn-end
// push announce the same die a second time (stagedPush.js#gambitRollNotices).
const DEPRESSED_SLUG = "depressed";
const THANATI_SLUG = "thanati";
const THANATI_LEADER_SLUG = "thanati-leader";

async function tortureCharacterRequestImpl({ targetCharacterId }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id)
    throw new UserError("You can't torture yourself.");
  // Re-checked here and not merely in the UI: the hidden button is a hint.
  const torturerSlugs = character.tags.map((ct) => ct.tag.slug);
  if (!torturerSlugs.includes(TORTURER_SLUG))
    throw new UserError("You don't know how.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    select: {
      ...EXAMINE_SUBJECT_SELECT,
      status: true,
      locationId: true,
      discordUserId: true,
      tags: {
        select: {
          ...EXAMINE_SUBJECT_SELECT.tags.select,
          tagId: true,
          tag: { select: { ...EXAMINE_SUBJECT_SELECT.tags.select.tag.select, slug: true } },
        },
      },
    },
  });
  if (!target || !isHere(character, target))
    throw new UserError(notHereMessage(target));
  if (!isBoundTarget(target))
    throw new UserError(`${target.name} isn't tied up.`);
  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);

  // Imperturbable: there is nothing in there to break.
  //
  // BELOW requireFreeMove on purpose, so the attempt costs the torturer their
  // Move. Above it, this was a free probe: anyone could test a bound target for
  // a hidden tag (`visible: false`) at no cost at all and read the answer off
  // the refusal. Spending the Move matches pain-immunity, which lets the
  // torturer roll and waste it. The target's mood and the −40 are still spared.
  if (target.tags.some((ct) => ct.tag.slug === IMPERTURBABLE_SLUG))
    throw new UserError(
      `${target.name} looks back at you, entirely unbothered. There is nothing here to break.`,
    );

  const equipmentInReach = await hasEquipmentInReach(
    prisma,
    character,
    TORTURING_EQUIPMENT_SLUG,
  );
  const targetSlugs = target.tags.map((ct) => ct.tag.slug);
  // The TORTURER's die, so it is the torturer's Lucky that bends it — the same
  // side gambitMods below are computed for. Both dice are carried through, so
  // the roll line can show the one that was thrown away.
  const tortureRoll = rollWithAdvantage(character.tags);
  const result = resolveTorture({
    die: tortureRoll.die,
    rolls: tortureRoll.rolls,
    torturerSlugs,
    targetSlugs,
    equipmentInReach,
    // Hungry, Afraid and Panicking count here as on any Gambit.
    gambitMods: gambitModifiers(character.tags, {
      hungerStreak: character.hungerStreak,
      mood: character.mood,
    }),
  });
  const rollLine = formatTortureRoll(result);

  // Everything a break gives up, gathered before the write so the transaction
  // stays short. None of it is needed on a hold.
  let reveal = null;
  let depressed = null;
  if (result.success) {
    depressed = await prisma.tag.findUnique({
      where: { slug: DEPRESSED_SLUG },
      select: { id: true, stackable: true },
    });
    const [desires, thanati] = await Promise.all([
      prisma.desire.findMany({
        where: { characterId: target.id, status: "FULFILLED" },
        orderBy: [{ endedTurnNumber: "desc" }, { id: "desc" }],
        take: 3,
        select: { text: true, points: true },
      }),
      targetSlugs.includes(THANATI_LEADER_SLUG)
        ? prisma.character.findMany({
            where: {
              status: "ALIVE",
              id: { not: target.id },
              tags: { some: { tag: { slug: THANATI_SLUG } } },
            },
            orderBy: { name: "asc" },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);
    const readout = tortureReadout({ subject: target, openTurnNumber: openTurn.number });
    reveal = {
      ...readout,
      desires,
      thanatiNames: thanati ? thanati.map((c) => c.name) : null,
    };
  }

  const outcome = result.success ? "they broke" : "they held out";
  await prisma.$transaction(async (tx) => {
    // +40, or nothing under Pain Immunity / an Opium High (MOOD.md §6).
    await applyMood(tx, target.id, { kind: "TORTURED" });
    if (result.success && depressed) {
      // An EVENT grant, so Depressed's conflictsWith (a purchase-time check)
      // does not stop it — the same door a GM grant walks through.
      await addToStack(tx, target.id, depressed.id, 1, {
        source: "EVENT",
        stackable: depressed.stackable,
      });
    }
    await fileAutoRoutine(
      tx,
      character,
      openTurn,
      `Tortured ${target.name}: ${rollLine} — ${outcome}.`,
      "auto:torture",
    );
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_torture_character",
      targetCharacterId: target.id,
      turnId: openTurn.id,
      details: {
        targetName: target.name,
        die: result.die,
        total: result.total,
        threshold: result.threshold,
        success: result.success,
        modifiers: result.modifiers,
        equipmentInReach,
        ...(reveal
          ? {
              revealedTagNames: reveal.tags.map((t) => t.name),
              desires: reveal.desires.map((d) => d.text),
              thanatiNames: reveal.thanatiNames,
              depressedTagId: depressed?.id ?? null,
            }
          : {}),
      },
    });
  });

  await afterInventoryChange(target.id);
  if (reveal) {
    notifyCharacter(
      character,
      `${rollLine}.`,
      {
        embeds: [
          buildTortureEmbed({
            name: reveal.name,
            avatarUrl: `${CANONICAL_ORIGIN}${reveal.avatarPath}`,
            tags: reveal.tags,
            desires: reveal.desires,
            thanatiNames: reveal.thanatiNames,
          }),
        ],
        meta: { embed: true },
      },
    );
    notifyCharacter(
      target,
      "You were tortured and failed to conceal your secrets. The torturer now knows everything about you.",
    );
  } else {
    notifyCharacter(character, `${rollLine}. They held out.`);
    notifyCharacter(target, "You were tortured, but held out. It won't be long, now...");
  }
  revalidateAll();
  return { name: target.name, success: result.success, die: result.die };
}

// --- Putting on a face that isn't yours ------------------------------------

// The Disguise Kit's one verb. Three turns under a name the player types, and
// the kit is NOT used up — a disguise kit you can use once is a costume, not a
// kit.
//
// The whole effect is a MINTED tag row carrying Tag.forcedName
// (db/lib/disguiseMint.js). Nothing on the Character row changes, so every
// surface that resolves an identity picks it up through the forced branch of
// presentedIdentity() that Apex Form already uses, and the ordinary expiry
// sweep takes it off again with no catch-up pass to write.
//
// Two things the player is told up front by the tag's own description, because
// both fall straight out of riding forcedName: they post under a letter plaque
// rather than their portrait, and /conceal refuses while it is on.
async function disguiseSelfRequestImpl({ name: rawName }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // Re-checked here and not merely in the UI: a server action is a public
  // endpoint, and page.js's predicate is a hint.
  if (!character.tags.some((ct) => ct.tag.slug === DISGUISE_KIT_SLUG))
    throw new UserError("You have no disguise kit.");

  const name = normalizeDisguiseName(rawName);
  if (!name) throw new UserError("Pick a name to go by.");
  if (name === character.name)
    throw new UserError("That is already your name.");

  // One at a time. Two forcedName rows would race, and forcedNameFrom takes
  // whichever comes back first.
  const already = await activeDisguise(prisma, character.id);
  if (already)
    throw new UserError(
      `You are already going by ${already.tag.forcedName}. Wait for it to wear off.`,
    );

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  // Minted OUTSIDE the transaction, on purpose: the retry loop it uses cannot
  // run inside one, because Postgres aborts the whole transaction on the first
  // failed statement (see db/lib/paperMint.js). Two players picking the same
  // false name is exactly the collision it retries past.
  const tag = await mintDisguise(prisma, character.id, name, openTurn);
  if (!tag) throw new UserError("Couldn't put that name on. Try another.");

  const effect = {
    tagId: tag.id,
    tagName: tag.name,
    disguiseName: name,
    turns: DISGUISE_TURNS,
  };
  await prisma.$transaction(async (tx) => {
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_disguise_self",
      targetCharacterId: character.id,
      details: effect,
    });
  });

  // The mention token follows the false name (PROXYING.md §6), and this is the
  // one moment a player is watching for it — a disguise that only takes hold
  // at the next turn roll is a disguise that did not work when it was put on.
  // Taking it OFF can wait for the reconcile in advanceTurn
  // (db/lib/characterRoleNames.js), which is what covers every other way a
  // forcedName tag can arrive or leave.
  //
  // Best-effort and outside the transaction, the rule for every Discord call
  // (ARCHITECTURE.md §5): the disguise is the tag, not the role, and a Discord
  // hiccup must not cost somebody their kit.
  await ensureCharacterRole(character).catch(() => {});

  await afterInventoryChange(character.id);
  revalidateAll();
  return { name };
}

// --- Harming someone already helpless -------------------------------------

// Wounding and finishing off in one request, since they're one act. Either
// half alone is valid, but not neither. The target must ALREADY be helpless
// — fighting back is a Gambit for a GM. Finishing them ends their game on
// submit (REQUESTS.md §5a); the gate that makes that safe is
// FINISHABLE_SLUGS (Dying or Bound — deliberately not Catatonic, an absent
// player rather than a helpless one).
async function harmCharacterRequestImpl({
  targetCharacterId,
  tagId,
  lethal: rawLethal,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id)
    throw new UserError("Pick someone else.");

  const lethal = Boolean(rawLethal);
  const wantsTag = Boolean(tagId);
  if (!wantsTag && !lethal)
    throw new UserError("Pick an injury, tick Finish them, or both.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    include: { tags: { include: { tag: { select: { slug: true } } } } },
  });
  if (!target || !isHere(character, target))
    throw new UserError(notHereMessage(target));

  const heldSlugs = new Set(target.tags.map((ct) => ct.tag.slug));
  if (![...heldSlugs].some((slug) => INCAPACITATING_SLUGS.has(slug))) {
    throw new UserError(
      "They can still defend themselves — that's a Gambit, not a request.",
    );
  }
  if (lethal && ![...heldSlugs].some((slug) => FINISHABLE_SLUGS.has(slug))) {
    throw new UserError("You can only finish off someone Dying or Bound.");
  }

  let tag = null;
  if (wantsTag) {
    tag = await prisma.tag.findUnique({
      where: { id: tagId },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        custom: true,
        group: { select: { slug: true } },
        stackable: true,
        defaultDurationTurns: true,
      },
    });
    if (!tag) throw new UserError("Unknown injury.");
    if (!isInflictable(tag)) throw new UserError("That isn't an injury.");
    if (target.tags.some((ct) => ct.tagId === tag.id)) {
      throw new UserError(`${target.name} already has ${tag.name}.`);
    }
  }

  const openTurn = await getOpenTurn();
  const expiresTurn = tag
    ? await expiryForGrant(prisma, tag, openTurn, {
        characterId: target.id,
        where: "harmCharacter",
      })
    : null;

  let killed = false;
  await prisma.$transaction(async (tx) => {
    if (tag) {
      await addToStack(tx, target.id, tag.id, 1, {
        source: "EVENT",
        expiresTurn,
        stackable: tag.stackable,
      });
    }
    // Conditional `status: ALIVE` where-clause, same as every other death
    // path (db/lib/characterDeath.js), so two finishers can't both claim it.
    if (lethal) {
      const claim = await tx.character.updateMany({
        where: { id: target.id, status: "ALIVE" },
        data: { status: "DEAD" },
      });
      killed = claim.count > 0;
    }
    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tagId: tag?.id ?? null,
      tagName: tag?.name ?? null,
      expiresTurn,
      lethal,
      killed,
      killedAt: killed ? new Date().toISOString() : null,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_harm_character",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  // killCharacter's applyDeathToRow runs with expectStatus DEAD (the shape
  // of the claim above) and revokes access itself.
  if (killed) {
    await killCharacter(target, "Someone finished you off.").catch((err) =>
      console.error(`killCharacter failed after finishing ${target.id}:`, err),
    );
    revalidatePath("/gm/players", "layout");
  } else {
    if (tag) {
      await afterInventoryChange(target.id);
    }
    notifyCharacter(target, "Someone hurt you.");
  }
  revalidateAll();
  return { killed };
}

// --- Desires ----------------------------------------------------------

// ONE action: claim a Desire — a retroactive claim on something the
// character already did. A GM reviews it afterwards like every other
// request; the anti-loop rule (DESIRES.md §8) is GM-adjudicated from the
// reason field, since no gate here can tell a real evening from a made-up one.
async function claimDesireImpl({
  slotIndex: rawSlotIndex,
  slug: rawSlug,
}) {
  const { session, character } = await requireCharacter();

  const slug = rawSlug?.toString().trim();
  if (!slug) throw new UserError(DESIRE_NOT_AVAILABLE);

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: {
      desireSlots: true,
      desireSlotLockTurns: true,
    },
  });
  const desireSlots = config?.desireSlots ?? 2;
  const lockTurns = config?.desireSlotLockTurns ?? 1;

  const slotIndex = parseCount(rawSlotIndex, { min: 0, max: desireSlots - 1 });
  if (slotIndex == null) throw new UserError("That Desire slot doesn't exist.");

  const template = await prisma.desireTemplate.findUnique({
    where: { slug },
    include: {
      requiresAnyTags: { select: { id: true, name: true } },
      requiresNotTags: { select: { id: true, name: true } },
    },
  });
  if (!template || template.retired) throw new UserError(DESIRE_NOT_AVAILABLE);

  const roleBySlugForDesire = await loadRoleBySlugForTemplates(prisma, [
    template,
  ]);
  const projectedTemplate = projectDesireTemplateForGates(
    roleBySlugForDesire,
    template,
  );

  const heldTags = character.tags.map((ct) => ct.tag);
  const heldTagIds = new Set(heldTags.map((t) => t.id));
  const hiddenTagIds = await computeHiddenDesireTagIds(prisma, heldTagIds);
  const roleSlug = character.role?.slug ?? null;

  const openTurn = await getOpenTurn();
  const openTurnNumber = openTurn?.number ?? 0;

  // The same pure checks the picker ran. Called once outside the transaction
  // as a cheap pre-check, then again inside it on a fresh read taken after
  // the row lock, to close the TOCTOU window between the two.
  function assertAvailable(history) {
    const { visible, hidden } = evaluateDesireCatalog({
      templates: [projectedTemplate],
      heldTags,
      hiddenTagIds,
      roleSlug,
      history,
      openTurnNumber,
      desireSlots,
    });
    if (hidden.length > 0) throw new UserError(DESIRE_NOT_AVAILABLE);
    const evaluated = visible[0];
    if (!evaluated || evaluated.state !== "available")
      throw new UserError(DESIRE_NOT_AVAILABLE);

    const slotLock = evaluated.slotLocks?.[slotIndex];
    if (slotLock) throw new UserError(`${slotLock} in that slot.`);

    const slots = slotStates({
      history,
      openTurnNumber,
      desireSlots,
      lockTurns,
      // Manic: the slot never shuts. Same helper the three display surfaces
      // call, so what the sheet offers is what this accepts.
      noLock: desireSlotsNeverLock(character.tags),
    });
    const slot = slots[slotIndex];
    if (slot?.lockedUntilTurn != null) {
      throw new UserError(
        `That slot is locked for ${slot.lockedTurnsLeft} more turn${slot.lockedTurnsLeft === 1 ? "" : "s"}.`,
      );
    }
  }

  const historySelect = {
    id: true,
    templateId: true,
    slotIndex: true,
    status: true,
    endedTurnNumber: true,
  };
  const historyPreCheck = await prisma.desire.findMany({
    where: { characterId: character.id },
    select: historySelect,
  });
  assertAvailable(historyPreCheck);

  // Row lock so two simultaneous claims can't both see "available" and land.
  const desire = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${character.id} FOR UPDATE`;
    const historyInTx = await tx.desire.findMany({
      where: { characterId: character.id },
      select: historySelect,
    });
    assertAvailable(historyInTx);

    // Born ended: the claim IS the fulfilment.
    const row = await tx.desire.create({
      data: {
        characterId: character.id,
        templateId: template.id,
        slotIndex,
        text: template.name,
        points: template.tier,
        status: "FULFILLED",
        setTurnNumber: openTurn?.number ?? null,
        endedTurnNumber: openTurn?.number ?? null,
      },
    });
    await tx.character.update({
      where: { id: character.id },
      data: { tagPoints: { increment: row.points } },
    });
    // Getting what you wanted settles the nerves, 10 a point (MOOD.md).
    await applyMood(tx, character.id, { kind: "DESIRE", base: DESIRE_RELIEF_PER_POINT * row.points });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_fulfill_desire",
      targetCharacterId: character.id,
      details: {
        desireId: row.id,
        pointsAwarded: row.points,
        slug: template.slug,
        slotIndex,
      },
    });
    return row;
  });

  await recordArchiveEvent({
    kind: "DESIRE_FULFILLED",
    character,
    zoneId: character.zoneId ?? null,
    turn: openTurn,
    content: `${character.name} fulfilled a Desire: ${desire.text}`,
  });

  revalidateAll();
  return {};
}

// --- Name ---------------------------------------------------------------

// The one player-facing rename: all four parts of a name, applying the same
// caps and dynasty lock every other writer of Character.name uses. See
// docs/systemdocs/CHARACTERS.md §1b.
// Renaming costs a Mulligan Potion, drunk from the tag's own tooltip. The gate
// is the whole point of the item — "a new name and appearance to those with
// honest regrets" is what its catalog text has always promised — and without
// it a name is free to change as often as a player likes, which makes every
// other identity rule (the personal Discord role, a wanted poster, a Disguise
// that is supposed to be temporary) mean less than it should. A Disguise is
// the temporary answer; this is the permanent one. See CHARACTERS.md.
const MULLIGAN_SLUG = "mulligan-potion";

async function changeNameRequestImpl({
  honorific: rawHonorific,
  firstName: rawFirstName,
  title: rawTitle,
  lastName: rawLastName,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // Re-checked here and not merely in the UI: a server action is a public
  // endpoint and page.js's predicate is only a hint.
  const potion = character.tags.find((ct) => ct.tag.slug === MULLIGAN_SLUG);
  // Read here beside the potion, dropped inside the transaction below.
  const warrant = character.tags.find((ct) => ct.tag.slug === WANTED_SLUG);
  if (!potion) {
    throw new UserError(
      "You need a Mulligan Potion to take a new name.",
    );
  }

  // Free text here, unlike creation: what a bottle sells is the whole
  // identity, prefix and quoted title included, so this path deliberately
  // does NOT run normalizeEarnedHonorific. A prefix a character drank is no
  // longer proof they earned anything — which is a thing other characters can
  // find out the hard way. Capped, though; every writer of `name` is.
  const honorific =
    rawHonorific?.toString().trim().slice(0, NAME_LIMITS.honorific) || null;
  // The one player-facing writer of `title`, the part that renders in quotes.
  const title = rawTitle?.toString().trim().slice(0, NAME_LIMITS.title) || null;
  const firstName =
    rawFirstName?.toString().trim().slice(0, NAME_LIMITS.firstName) || null;
  if (!firstName) throw new UserError("A character needs a first name.");

  // A dynasty member wears the head's last name — never read from the post.
  const dynastyMember = isDynastyMember(character.role?.slug);
  const lastName = dynastyMember
    ? character.lastName
    : rawLastName?.toString().trim().slice(0, NAME_LIMITS.lastName) || null;

  const previous = {
    honorific: character.honorific,
    firstName: character.firstName,
    title: character.title,
    lastName: character.lastName,
    name: character.name,
  };
  const next = {
    honorific,
    firstName,
    title,
    lastName,
    name: formatCharacterName({
      honorific,
      firstName,
      title,
      lastName,
    }),
  };

  if (next.name === previous.name)
    throw new UserError("That's already your name.");

  const openTurn = await getOpenTurn();

  let updated;
  await prisma.$transaction(async (tx) => {
    // The potion was read outside this transaction, so lock the row before
    // spending it: two submits in flight would both see one bottle, and
    // dropCharacterTag no-ops silently on the second — one potion, two names.
    // Craft and Heal in this file take the same lock for the same reason.
    await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${character.id} FOR UPDATE`;
    const stillHeld = await tx.characterTag.findFirst({
      where: { characterId: character.id, tagId: potion.tagId, quantity: { gt: 0 } },
      select: { id: true },
    });
    if (!stillHeld) throw new UserError("You need a Mulligan Potion to take a new name.");
    updated = await tx.character.update({
      where: { id: character.id },
      data: next,
    });
    // Drunk, not merely held — one name per bottle.
    await dropCharacterTag(tx, character.id, potion.tagId, 1);
    // And the warrant goes with the old name. A Wanted man who buys a whole
    // new identity has bought his way off the list — that is what the bottle
    // is FOR, and leaving the tag on would mean the Cerberon still read him
    // as wanted under a name their own book has never heard of.
    if (warrant) await dropCharacterTag(tx, character.id, warrant.tagId);
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_change_name",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: {
        previousName: previous.name,
        name: next.name,
        previousTitle: previous.title,
        title: next.title,
        potionTagId: potion.tagId,
        ...(warrant ? { clearedWanted: true } : {}),
      },
    });
  });

  // Best-effort Discord fan-out, outside the transaction (ARCHITECTURE.md §5
  // — no network call inside one). The role and the nickname wear the REAL
  // bare name on purpose, disguise or not (PROXYING.md §6, §8).
  await ensureCharacterRole(updated).catch(() => {});
  await syncCharacterNickname(
    session.discordUserId,
    formatBareName(updated),
  ).catch(() => {});
  await afterInventoryChange(character.id);
  if (
    isDynastyHead(character.role?.slug) &&
    next.lastName !== previous.lastName
  ) {
    await propagateDynastyLastName(next.lastName).catch((err) =>
      console.error("propagateDynastyLastName failed:", err),
    );
  }

  revalidateAll();
  return { name: next.name };
}

// --- Bodies: Butcher, Bury, Engrave --------------------------------------
//
// All three act on a CORPSE TAG rather than on a name typed into a box, which
// is the change docs/systemdocs/CORPSES.md is really about: a body is an
// object you hold or can walk up to. Engrave is the exception, and it is the
// exception on purpose — see its own comment.

// The one reach rule the three share, and the reason they cannot disagree
// about what you can touch: a corpse in your own hands, or one lying in a Room
// at your Location you can actually get into. Location-grain, because that is
// what a room stash is (CARRY.md §5).
//
// Re-resolved server-side from the posted ids every time. The dialog's list is
// advisory; this is the gate that holds when a client posts its own ids.
async function resolveCorpseSource(character, { tagId, sourceKey }) {
  const reachable = await corpsesInReach(prisma, character);
  const found = reachable.find(
    (c) => c.tagId === tagId && c.sourceKey === sourceKey,
  );
  // One message for both "you made that up" and "someone got there first",
  // deliberately: telling them apart would say whether a body they cannot see
  // exists, which is the scouting leak the reach rule exists to prevent.
  if (!found) throw new UserError("That body isn't there any more.");
  return found;
}

// Taking the body off whatever was holding it. The conditional write IS the
// check in both branches — a room is the game's first multi-actor inventory
// (CARRY.md §5), and two of your own tabs can race just as well.
async function takeCorpse(tx, corpse) {
  if (corpse.source.kind === "room") {
    const { ok } = await dropRoomTag(tx, corpse.source.id, corpse.tagId, 1);
    if (!ok) throw new UserError("That body isn't there any more.");
    return;
  }
  const gone = await tx.characterTag.deleteMany({
    where: { characterId: corpse.source.id, tagId: corpse.tagId },
  });
  if (gone.count === 0)
    throw new UserError("That body isn't there any more.");
}

// Butchering. FREE — no ⬢, no Move — and it consumes the body.
//
// It deliberately does NOT free the soul: cutting someone up destroys the
// evidence without burying them, so their player stays Cursed. That is the
// hole Engrave exists to fill, and it reads as an oversight unless you know
// it was a choice.
async function butcherCorpseRequestImpl({
  tagId,
  sourceKey,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // The gate, re-checked here because a disabled button is a hint, not a lock.
  if (!character.tags.some((ct) => ct.tag?.slug === BUTCHER_SLUG)) {
    throw new UserError("You don't know how to butcher.");
  }

  const corpse = await resolveCorpseSource(character, { tagId, sourceKey });
  const yieldTag = await prisma.tag.findUnique({
    where: { slug: corpse.yieldSlug },
  });
  // A catalog out of step with the code. Refusing is right: silently granting
  // nothing would read to the player as the button being broken.
  if (!yieldTag) throw new UserError("Nothing comes of that one. Tell a GM.");

  const openTurn = await getOpenTurn();
  const expiresTurn = await expiryForGrant(prisma, yieldTag, openTurn, {
    reason: "butcher",
  });

  await prisma.$transaction(async (tx) => {
    await takeCorpse(tx, corpse);
    await addToStack(tx, character.id, yieldTag.id, 1, {
      source: "EVENT",
      expiresTurn,
      stackable: yieldTag.stackable,
    });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_butcher_corpse",
      targetCharacterId: corpse.deadCharacterId ?? character.id,
      details: {
        corpse: corpse.tagName,
        made: yieldTag.name,
        source: corpse.source.kind,
      },
    });
  });

  await afterInventoryChange([character.id]);

  // The dead player is told, and never told by whom — the same posture every
  // other request that acts on someone else takes.
  if (corpse.human && corpse.deadCharacterId) {
    const dead = await prisma.character.findUnique({
      where: { id: corpse.deadCharacterId },
    });
    if (dead) notifyCharacter(dead, "Somebody has cut your body apart.");
  }
  // A public room's contents changing is public by nature (CARRY.md §6).
  if (corpse.source.kind === "room") {
    after(() =>
      announceInRoom(corpse.source, character, "butchers a body here."),
    );
  }

  revalidateAll();
  return { made: yieldTag.name };
}

// Mutilating. One piece off a bound person or a corpse, and it is FREE — no ⬢,
// no Move, no turn. Press it again for the next piece; the ladder in
// db/lib/mutilate.js is what stops a third eye.
//
// It deliberately does NOT consume the body the way Butcher does. Butchering
// is the whole corpse at once; this is picking at one, and you should be able
// to come back for the other eye.
//
// The part menu is UNFILTERED on the client on purpose (see the dialog): which
// rungs a subject has left is a fact about their sheet, and offering only the
// ones they still have would answer "what are they already missing?" to anyone
// who opened it. The refusal here is where they find out.
async function mutilateRequestImpl({
  targetCharacterId,
  tagId,
  sourceKey,
  part,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  // Re-checked here and not merely in the UI: the hidden button is a hint.
  const actorSlugs = character.tags.map((ct) => ct.tag.slug);
  if (!actorSlugs.some((slug) => MUTILATE_GATE_SLUGS.includes(slug)))
    throw new UserError("You couldn't bring yourself to.");

  const named = partFor(part);
  if (!named) throw new UserError("That isn't something you could take.");

  // Two subjects, one action. A corpse resolves through the reach rule Butcher
  // and Bury already share; a living person through the Bound-and-here check
  // Torture already makes. Either way what comes out is ONE Character row to
  // injure, so everything below this is common.
  let corpse = null;
  let subject = null;
  if (tagId) {
    corpse = await resolveCorpseSource(character, { tagId, sourceKey });
    // A Nekker has no sheet to injure and nothing recognisable to take.
    if (!corpse.human || !corpse.deadCharacterId)
      throw new UserError("There's nothing in that one you'd want.");
    subject = await prisma.character.findUnique({
      where: { id: corpse.deadCharacterId },
      include: { tags: { include: { tag: { select: { slug: true } } } } },
    });
    if (!subject) throw new UserError("That body isn't there any more.");
  } else {
    if (targetCharacterId === character.id)
      throw new UserError("You can't do that to yourself.");
    // The WHOLE row, not a select: a lethal part hands this straight to
    // killCharacter, which reads discordRoleId and everything
    // revokeAllCharacterAccess needs. The Harm path loads it the same way and
    // for the same reason — a partial row there orphans a Discord role.
    subject = await prisma.character.findFirst({
      where: { id: targetCharacterId ?? "", status: "ALIVE" },
      include: { tags: { include: { tag: { select: { slug: true } } } } },
    });
    if (!subject || !isHere(character, subject))
      throw new UserError(notHereMessage(subject));
    if (!isBoundTarget(subject))
      throw new UserError(`${subject.name} isn't tied up.`);
  }

  const step = resolveMutilation(
    part,
    subject.tags.map((ct) => ct.tag.slug),
  );
  if (!step)
    throw new UserError(`There's no ${named.label.toLowerCase()} left to take.`);

  const [grantTag, itemTag] = await Promise.all([
    prisma.tag.findUnique({ where: { slug: step.grantSlug } }),
    prisma.tag.findUnique({ where: { slug: step.itemSlug } }),
  ]);
  // A catalog out of step with the code. Refusing is right: granting nothing
  // silently would read to the player as the button being broken.
  if (!grantTag || !itemTag)
    throw new UserError("Nothing comes of that one. Tell a GM.");
  const dropTag = step.dropSlug
    ? await prisma.tag.findUnique({ where: { slug: step.dropSlug } })
    : null;

  const openTurn = await getOpenTurn();
  const expiresTurn = await expiryForGrant(prisma, itemTag, openTurn, {
    characterId: character.id,
    where: "mutilate",
  });
  // The organs kill, but only somebody who is still using them.
  const kills = step.lethal && subject.status === "ALIVE";

  await prisma.$transaction(async (tx) => {
    if (dropTag) await dropCharacterTag(tx, subject.id, dropTag.id);
    await addToStack(tx, subject.id, grantTag.id, 1, {
      source: "EVENT",
      stackable: grantTag.stackable,
    });
    await addToStack(tx, character.id, itemTag.id, 1, {
      source: "EVENT",
      expiresTurn,
      stackable: itemTag.stackable,
    });
    // A corpse feels nothing. applyMood on a dead row would move a dial
    // nobody reads and show up in the mood log as a live event.
    if (subject.status === "ALIVE")
      await applyMood(tx, subject.id, { kind: "MUTILATED" });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_mutilate",
      targetCharacterId: subject.id,
      turnId: openTurn?.id ?? null,
      details: {
        subjectName: subject.name,
        part: step.part,
        granted: grantTag.name,
        dropped: dropTag?.name ?? null,
        item: itemTag.name,
        lethal: kills,
        source: corpse ? corpse.source.kind : "person",
        ...(corpse ? { corpse: corpse.tagName } : {}),
      },
    });
  });

  await afterInventoryChange([character.id, subject.id]);

  // Unattributed, like every other request that acts on somebody else. The
  // death DM rides on killCharacter so nothing ever sends two.
  if (kills) {
    await killCharacter(subject, `Your ${named.label.toLowerCase()} was cut out.`).catch(
      (err) =>
        console.error(`Failed to kill mutilated character ${subject.id}:`, err),
    );
  } else if (corpse) {
    notifyCharacter(subject, "Somebody has been cutting pieces off your body.");
  } else {
    notifyCharacter(subject, `Somebody cut off your ${named.label.toLowerCase()}.`);
  }

  // A public room's contents changing is public by nature (CARRY.md §6). Said
  // vaguely on purpose — the room learns a body was cut, not what came off it.
  if (corpse && corpse.source.kind === "room") {
    after(() =>
      announceInRoom(corpse.source, character, "cuts something off a body here."),
    );
  }

  revalidateAll();
  return { part: named.label, name: subject.name };
}

// Scenery into the Location the actor is standing in. Corpse work is the most
// visible thing a person can do with a body, and until now only a room stash
// pull said anything. `requireCharacter` carries no `character.location`, so
// the channel is read here (the same lookup every other action in this file
// does).
async function speakHere(character, text) {
  if (!character.locationId) return;
  const location = await prisma.location.findUnique({
    where: { id: character.locationId },
    select: { discordChannelId: true },
  });
  speakAtSite(location?.discordChannelId, ambientLine(text));
}

// Burying. Takes the body — you have to actually have it, or be able to reach
// it — and spends your Move.
//
// The old version matched a TYPED first name against the dead in your zone.
// That input has not gone away; it moved to Engrave, which is the one that
// still needs it.
async function buryCharacterRequestImpl({
  tagId,
  sourceKey,
}) {
  const { session, character } = await requireCharacter();

  const corpse = await resolveCorpseSource(character, { tagId, sourceKey });
  if (!corpse.human || !corpse.deadCharacterId) {
    throw new UserError("There's no soul in that one.");
  }
  const target = await prisma.character.findUnique({
    where: { id: corpse.deadCharacterId },
  });
  if (!target) throw new UserError("There's nobody left to bury.");
  if (target.buriedAt) throw new UserError("They're already in the ground.");

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);
  const buriedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await takeCorpse(tx, corpse);
    await tx.character.update({ where: { id: target.id }, data: { buriedAt } });
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      `Buried ${target.name}.`,
      "auto:bury",
    );
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_bury_character",
      targetCharacterId: target.id,
      details: { zoneId: character.zoneId, corpse: corpse.tagName },
    });
  });

  await removeGhostRole(target.discordUserId).catch((err) =>
    console.error(
      `Bury: failed to lift the curse from ${target.discordUserId}:`,
      err,
    ),
  );
  await afterInventoryChange([character.id]);

  notifyCharacter(target, "Your body was buried. The curse has lifted.");
  if (corpse.source.kind === "room") {
    after(() => announceInRoom(corpse.source, character, "takes a body away."));
  }
  await speakHere(character, `${target.name} was buried.`);

  revalidateAll();
  return { name: target.name };
}

// Engraving. The answer to a body nobody can find — so it is the ONE action
// here with no corpse and no reach check at all, and it searches the whole
// game rather than your zone.
//
// This is where Bury's typed name went, and the reasoning that kept it typed
// is unchanged and now stronger: a dropdown would answer "who is dead?" to
// anyone who opened the dialog, and the list would now be every corpse in
// Ravenheart rather than the ones at your feet.
//
// It used to match on the FIRST NAME alone, and that was too coarse for a game
// with a hundred people in it: first names repeat constantly, so a mourner who
// knew exactly whose stone they were cutting got told "more than one dead
// person answers to that name" and had to go find a GM. It matches the whole
// name now — matchesTypedName takes either the full display name or the plain
// First Last, so an honorific nobody told them about is not a wall.
//
// The >1-match refusal stays, and now it means what it says: two dead people
// with the same full name. It is the only thing standing between a mourner and
// freeing the wrong soul.
async function engraveHeadstoneRequestImpl({
  name: rawName,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const typed = rawName?.toString().trim().slice(0, FULL_NAME_LIMIT) ?? "";
  if (!typed) throw new UserError("Whose name?");

  // No zone clause, on purpose (see above). The composed name is not something
  // Prisma can compare against, so the unburied dead — a short list — come
  // back and matchesTypedName does the rest.
  const candidates = await prisma.character.findMany({
    where: { status: "DEAD", buriedAt: null },
  });
  const matches = candidates.filter((c) => matchesTypedName(c, typed));
  if (matches.length === 0)
    throw new UserError("Nobody by that name is dead and unburied.");
  if (matches.length > 1) {
    throw new UserError(
      "More than one dead person answers to that name. A GM will have to do it.",
    );
  }
  const target = matches[0];

  // The friendly refusal. The real check is the conditional debit below, which
  // is what actually stops the balance going negative.
  if (character.resources < ENGRAVE_RESOURCE_COST) {
    throw new UserError(`Engraving costs ${ENGRAVE_RESOURCE_COST} ⬢.`);
  }

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);
  const buriedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // The conditional debit, which is the check that actually holds — the
    // friendly refusal above only makes the message better.
    await debitResources(
      tx,
      { kind: "character", id: character.id, name: character.name },
      ENGRAVE_RESOURCE_COST,
    );
    await tx.character.update({ where: { id: target.id }, data: { buriedAt } });
    const headstone = await mintHeadstone(tx, target);
    await addToStack(tx, character.id, headstone.id, 1, {
      source: "EVENT",
      expiresTurn: null,
      stackable: false,
    });
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      `Engraved a headstone for ${target.name}.`,
      "auto:engrave",
    );
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_engrave_headstone",
      targetCharacterId: target.id,
      details: { spent: ENGRAVE_RESOURCE_COST },
    });
    return { headstone };
  });

  await removeGhostRole(target.discordUserId).catch((err) =>
    console.error(
      `Engrave: failed to lift the curse from ${target.discordUserId}:`,
      err,
    ),
  );
  await afterInventoryChange([character.id]);

  notifyCharacter(
    target,
    "Somebody carved your name in stone. The curse has lifted.",
  );
  await speakHere(character, `A headstone was engraved for ${target.name}.`);

  revalidateAll();
  return { name: target.name, headstone: result.headstone.name };
}

// --- The Godard Factory -----------------------------------------------

// Cutting Godflesh out of the marsh. Rolls a d6, and on a 1 rolls again on a
// table that Armored Gloves dominate — db/lib/godflesh.js holds all of that,
// and this only writes the result down.
//
// It costs NO Move. It used to spend the Routine through fileAutoRoutine, which
// is where its "once per turn" came from for free; now it carries its own
// once-a-day claim instead (Character.extractDayKey, FACTORY.md §3). Nothing
// here touches the Action table or the move lock any more — cutting and working
// your day are two separate things.
//
// Every gate is re-checked here. The button greys itself for a blade and hides
// itself off a marsh tile, but a server action is a public endpoint and the
// client's menus are advisory (REQUESTS.md §3).
async function extractGodfleshRequestImpl() {
  const { session, character } = await requireCharacter();

  const location = character.locationId
    ? await prisma.location.findUnique({
        where: { id: character.locationId },
        select: { id: true, name: true, attributes: true },
      })
    : null;
  if (!hasAttribute(location, GODFLESH_ATTRIBUTE)) {
    throw new UserError("There's nothing to cut here.");
  }
  if (!extractToolFor(character.tags)) {
    throw new UserError(
      "You need a hatchet, a battle-axe or a chainsaw in your hands.",
    );
  }
  // Bound, Dying, Paralyzed, Catatonic — or mid-Seizure from a cube, which is
  // the one this exists for. This is the ONLY thing standing between a man on
  // the floor and a wade into the marsh with an axe: the day claim below cares
  // about the calendar and nothing else, and there is no Move gate left at all.
  const floored = blockerFor(character.tags, ACT);
  if (floored) {
    throw new UserError(`You're in no state to be swinging anything — you're ${floored.name}.`);
  }

  // Still needed, for the day key and for dating the injury — but no longer as
  // a gate. The move lock is deliberately NOT consulted: Extract is outside
  // that window now, the same way the Bird is.
  const openTurn = await getOpenTurn();
  const dayKey = extractDayKey(openTurn);
  if (!dayKey) throw new UserError("No turn is open.");

  const result = rollExtraction(character.tags);
  const [godflesh, injury] = await Promise.all([
    prisma.tag.findUnique({
      where: { slug: GODFLESH_SLUG },
      select: { id: true, name: true, stackable: true },
    }),
    result.injury
      ? prisma.tag.findUnique({
          where: { slug: result.injury.tagSlug },
          select: { id: true, name: true, defaultDurationTurns: true },
        })
      : null,
  ]);
  if (!godflesh)
    throw new UserError("The catalog has no Godflesh in it. Tell a GM.");

  const effect = {
    die: result.die,
    tool: result.tool,
    tagId: godflesh.id,
    tagName: godflesh.name,
    quantity: result.quantity,
    injuryTagId: injury?.id ?? null,
    injuryTagName: injury?.name ?? null,
    locationName: location?.name ?? null,
  };

  await prisma.$transaction(async (tx) => {
    // The claim, and the first thing written — the Bird's shape (BIRD.md): a
    // conditional updateMany whose WHERE *is* the check, so two tabs submitting
    // at once cannot both cut. A stale key from an earlier day is overwritten
    // by the same statement, so nothing has to sweep it.
    const claimed = await tx.character.updateMany({
      where: {
        id: character.id,
        OR: [{ extractDayKey: null }, { extractDayKey: { not: dayKey } }],
      },
      data: { extractDayKey: dayKey },
    });
    if (claimed.count === 0) {
      throw new UserError("You already harvested Godflesh today.");
    }
    await addToStack(tx, character.id, godflesh.id, result.quantity, {
      source: "EVENT",
      stackable: godflesh.stackable,
    });
    if (injury) {
      await addToStack(tx, character.id, injury.id, 1, {
        source: "EVENT",
        expiresTurn: await expiryForGrant(tx, injury, openTurn, {
          characterId: character.id,
          where: "extractGodflesh",
        }),
      });
    }
    // No Action row any more, so this audit line is the WHOLE trace a cut
    // leaves. It carries turnId for the same reason every rationed action does
    // (REQUESTS.md §1a) — it is the only thing a GM can count.
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_extract_godflesh",
      targetCharacterId: character.id,
      turnId: openTurn.id,
      details: effect,
    });
  });

  await afterInventoryChange([character.id]);
  // The die is the point of the whole button, so it is DM'd whatever it said.
  notifyCharacter(
    character,
    extractionDm(result, { locationName: location?.name ?? null }),
  );

  revalidateAll();
  // The DM above carries the same facts with Discord's formatting; this is
  // the one-line version the page's notice shows.
  const got = result.quantity > 0 ? `${result.quantity} Godflesh` : "nothing";
  const hurt = injury ? ` It got hold of you first — ${injury.name}.` : "";
  return {
    die: result.die,
    quantity: result.quantity,
    injury: injury?.name ?? null,
    line: `You went out into the marsh and cut. The die came up ${result.die}: ${got}.${hurt}`,
  };
}

// Packing goods into a crate that weighs half what is in it.
//
// The crate is a runtime Tag, exactly the shape db/lib/depotCrates.js mints
// for a Depot shipment — `custom: true` and a `custom-` slug, so db:prune-tags
// leaves it alone and no docs/tags.yaml sync can upsert over it. It is an
// ordinary CONSUMABLE, which is what makes unpacking free: the Consume button
// already on the sheet opens it. A Depot crate now uses the same button, via
// openCrateRequestImpl above — it just needs its own road, because its
// contents are runtime tag IDs rather than catalog slugs.
async function packageItemsRequestImpl({
  lines: rawLines,
  label: rawLabel,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const label = String(rawLabel ?? "")
    .trim()
    .slice(0, PACKAGE_LABEL_MAX);

  // The line is OPTIONAL — a blank crate is a perfectly ordinary thing to
  // pack. But writing one is writing, so a packer who cannot read is offered
  // no field at all (actions/PackageDialog.js) and refused one here. Letters
  // AND eyes, the same readBlock the paper actions use, and the same single
  // sentence whichever of the two stopped them.
  if (label) {
    const labelTurn = await getOpenTurn();
    const where = {
      phase: labelTurn?.phase ?? null,
      indoors: character.location?.indoors ?? true,
    };
    if (readBlock(character.tags, where)) throw new UserError(CANNOT_READ);
  }

  const lines = (Array.isArray(rawLines) ? rawLines : [])
    .map((l) => ({
      tagId: String(l?.tagId ?? ""),
      quantity: Math.max(1, Math.trunc(Number(l?.quantity) || 1)),
    }))
    .filter((l) => l.tagId);
  if (lines.length === 0) throw new UserError("Nothing selected.");

  if (
    !(await hasEquipmentInReach(prisma, character, PACKAGING_EQUIPMENT_SLUG))
  ) {
    throw new UserError("There's no packaging equipment here.");
  }

  // Resolved against what they ACTUALLY hold, never against what was posted.
  const held = character.tags.filter((ct) =>
    lines.some((l) => l.tagId === ct.tagId),
  );
  const contents = lines.map((line) => {
    const row = held.find((ct) => ct.tagId === line.tagId);
    if (!row) throw new UserError("You aren't carrying that.");
    if (!isTradeable(row.tag))
      throw new UserError("That isn't something that can be packed.");
    // A crate of crates would nest a consumesInto chain arbitrarily deep, and
    // halving twice is a free carry exploit besides.
    if (isCrate(row.tag)) throw new UserError("You can't crate a crate.");
    // A mount is not cargo, and the MOUNT slot is weightless on purpose, so a
    // crate of one came out at crateWeight's floor of 1 lb. The Depot still
    // ships a horse crated (DEPOT.md §0e) — this refusal is the hand-packed
    // button only.
    if (isMount(row.tag))
      throw new UserError("That doesn't fit.");
    const quantity = Math.min(line.quantity, row.quantity);
    return {
      tagId: row.tagId,
      slug: row.tag.slug,
      name: row.tag.name,
      quantity,
      weightLbs: row.tag.weightLbs ?? 0,
    };
  });

  const innerLbs = contents.reduce(
    (sum, c) => sum + c.weightLbs * c.quantity,
    0,
  );
  if (innerLbs > PACKAGE_MAX_LBS) {
    throw new UserError(
      `A crate holds ${PACKAGE_MAX_LBS} lb. That's ${Math.round(innerLbs)}.`,
    );
  }
  // A second cap, on COUNT rather than weight, because the weight cap does not
  // bound the weightless: `consumesInto` repeats a slug per unit, so a crate of
  // obols (0 lb, stackable, no ceiling) would write an array as long as the
  // pile. The number is generous enough that nobody packing real cargo will
  // ever see it.
  const units = contents.reduce((sum, c) => sum + c.quantity, 0);
  if (units > PACKAGE_MAX_UNITS) {
    throw new UserError(
      `A crate holds ${PACKAGE_MAX_UNITS} things. That's ${units}.`,
    );
  }

  const weightByTagId = new Map(contents.map((c) => [c.tagId, c.weightLbs]));
  const group = await prisma.tagGroup.findUnique({
    where: { slug: "items-gear" },
  });
  const openTurn = await getOpenTurn();

  // The "custom-" prefix every runtime tag uses, plus enough entropy that two
  // people packing in the same tick cannot collide on the unique slug.
  const slug = `custom-crate-${character.id.slice(-6)}-${Date.now().toString(36)}`;

  let crate;
  await prisma.$transaction(async (tx) => {
    // Single-actor lock (fix round M4b, fix 3 sibling check): packing is
    // always the actor's own stacks, so there's no cross-character deadlock
    // order to reason about — just the same "two tabs packing at once"
    // shape the loot lock above guards against, on one row instead of two.
    await lockCharacter(tx, character.id);

    // Laundering fix (M4): drop the contents FIRST and capture what actually
    // left as poisoned — dropCharacterTag's own return, previously discarded
    // here, which is exactly how packing a poisoned item into a crate used
    // to launder it clean. Per-entry, carried on the manifest below, so
    // openCrateRequestImpl re-applies it on the unpack side rather than
    // silently dropping it a second time. One road now: the Depot's own
    // opener is gone and a crate is cracked through Consume wherever it is
    // carried.
    const poisonedContents = [];
    for (const c of contents) {
      const { poisonedTaken, poisonPayload } = await dropCharacterTag(
        tx,
        character.id,
        c.tagId,
        c.quantity,
      );
      poisonedContents.push({
        ...c,
        poisonedCount: poisonedTaken,
        poisonPayload: poisonedTaken > 0 ? poisonPayload : null,
      });
    }

    crate = await tx.tag.create({
      data: {
        slug,
        name: "Crate",
        // No line on the side means no description at all, rather than an
        // empty `[CONTAINS]:` that would read as a bug.
        description: label ? `[CONTAINS]: ${label}` : null,
        custom: true,
        // Game state, not catalog — a Restart Game sweeps it up (TAGS.md §5d).
        ephemeral: true,
        category: "items",
        groupId: group?.id ?? null,
        pointCost: 0,
        tradeable: true,
        stackable: false,
        // The COLUMN is inspectVisibility; `visible:` is only the name
        // docs/tags.yaml uses, and passing it here throws an unknown-argument
        // error whose message points at `groupId` rather than at the real
        // culprit. A crate is a box somebody is visibly hauling.
        inspectVisibility: "ALWAYS",
        weightLbs: crateWeight(contents, weightByTagId),
        // An item like any other, so it gets the Destroy button the category
        // rule gives the rest of them (db/lib/syncTags.js).
        removable: true,
        consumable: true,
        // Repeated per unit — that is how consumesInto expresses a quantity
        // (docs/tags.yaml header), and every packable thing worth crating in
        // bulk is stackable. Left in place for the crate's printed
        // description and as a fallback; the actual unpack (below) reads
        // crateContents instead so the poison state on each line survives —
        // grantTagSlugs (what consumesInto ultimately resolves through)
        // knows nothing about poison at all.
        consumesInto: contents.flatMap((c) => Array(c.quantity).fill(c.slug)),
        // Carried too, for parity with a Depot crate, so anything that reads
        // one manifest reads both. `poisonedCount`/`poisonPayload` per line
        // (M4) — omitted (not written as 0/null) for a clean line, so an
        // ordinary crate's manifest looks exactly as it always has.
        crateContents: poisonedContents.map((c) => ({
          tagId: c.tagId,
          name: c.name,
          quantity: c.quantity,
          ...(c.poisonedCount > 0
            ? { poisonedCount: c.poisonedCount, poisonPayload: c.poisonPayload }
            : {}),
        })),
      },
    });

    await addToStack(tx, character.id, crate.id, 1, {
      source: "EVENT",
      stackable: false,
    });

    const effect = {
      crateTagId: crate.id,
      crateName: crate.name,
      label,
      weightLbs: crate.weightLbs,
      innerLbs,
      contents,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_package_items",
      targetCharacterId: character.id,
      details: effect,
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { name: crate.name, weightLbs: crate.weightLbs, innerLbs };
}

// --- public surface ---------------------------------------------------

// Each action is wrapped so validation comes back as { ok: false, error }
// instead of being thrown — see web/lib/actionResult.js.

export async function craftRequest(input) {
  return guarded(() => craftRequestImpl(input));
}

export async function continueCraft(input) {
  return guarded(() => continueCraftImpl(input));
}

export async function cancelCraft(input) {
  return guarded(() => cancelCraftImpl(input));
}

// Opening a site has no export of its own: craftRequest() branches into it,
// because to a player raising a palisade is the same act as making a sword.
export async function joinBuildSite(input) {
  return guarded(() => joinBuildSiteImpl(input));
}

export async function cancelBuildSite(input) {
  return guarded(() => cancelBuildSiteImpl(input));
}

export async function destroyTagRequest(input) {
  return guarded(() => destroyTagRequestImpl(input));
}

export async function learnRequest(input) {
  return guarded(() => learnRequestImpl(input));
}

export async function teachRequest(input) {
  return guarded(() => teachRequestImpl(input));
}

export async function confessRequest(input) {
  return guarded(() => confessRequestImpl(input));
}

export async function kissRequest(input) {
  return guarded(() => kissRequestImpl(input));
}

export async function taxRequest(input) {
  return guarded(() => taxRequestImpl(input));
}

export async function transferRequest(input) {
  return guarded(() => transferRequestImpl(input));
}

export async function consumeTagRequest(input) {
  return guarded(() => consumeTagRequestImpl(input));
}

export async function poisonItemRequest(input) {
  return guarded(() => poisonItemRequestImpl(input));
}

export async function poisonCharacterRequest(input) {
  return guarded(() => poisonCharacterRequestImpl(input));
}

export async function healCharacterRequest(input) {
  return guarded(() => healCharacterRequestImpl(input));
}
export async function researchRequest(input) {
  return guarded(() => researchRequestImpl(input));
}

export async function claimDesire(input) {
  return guarded(() => claimDesireImpl(input));
}

export async function changeNameRequest(input) {
  return guarded(() => changeNameRequestImpl(input));
}

export async function lootCharacterRequest(input) {
  return guarded(() => lootCharacterRequestImpl(input));
}

export async function bindCharacterRequest(input) {
  return guarded(() => bindCharacterRequestImpl(input));
}
export async function freeCharacterRequest(input) {
  return guarded(() => freeCharacterRequestImpl(input));
}
export async function crucifyCharacterRequest(input) {
  return guarded(() => crucifyCharacterRequestImpl(input));
}
export async function tortureCharacterRequest(input) {
  return guarded(() => tortureCharacterRequestImpl(input));
}
export async function disguiseSelfRequest(input) {
  return guarded(() => disguiseSelfRequestImpl(input));
}
export async function harmCharacterRequest(input) {
  return guarded(() => harmCharacterRequestImpl(input));
}

export async function buryCharacterRequest(input) {
  return guarded(() => buryCharacterRequestImpl(input));
}

export async function butcherCorpseRequest(input) {
  return guarded(() => butcherCorpseRequestImpl(input));
}

export async function mutilateRequest(input) {
  return guarded(() => mutilateRequestImpl(input));
}

export async function engraveHeadstoneRequest(input) {
  return guarded(() => engraveHeadstoneRequestImpl(input));
}

// --- The Bird -------------------------------------------------------------
//
// One letter a day, to a named person in a GUESSED zone. See BIRD.md.
//
// The letter resolves INSTANTLY on a hit and SILENTLY on a miss — a wrong
// guess looks exactly like a successful send here; the sender isn't told
// until db/lib/birdPass.js reports it at turn close. That delay is the
// entire anti-scouting measure: answering "not delivered" now would hand
// every Bird-holder a free probe for whether someone is alive in a zone.
async function birdMessageRequestImpl({
  recipientId,
  guessedZoneId,
  tagId: rawTagId,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!holdsBirdAndLetters(character.tags)) {
    throw new UserError("You need a bird, and you need to be able to write.");
  }

  // The bird carries an OBJECT now. Resolved against what they actually hold,
  // never against what was posted. See docs/systemdocs/PAPERWORK.md.
  const held = character.tags.find((ct) => ct.tagId === String(rawTagId ?? ""));
  if (!held) throw new UserError("You aren't holding that.");
  const kind = held.tag.paperKind;
  if (kind !== "PAPER" && kind !== "SEALED") {
    throw new UserError("A bird carries letters, not that.");
  }
  if (kind === "PAPER" && !(held.tag.paperText ?? "").trim()) {
    throw new UserError("There's nothing written on it.");
  }

  // A snapshot for the GM desk, so a letter that is later resealed, torn up or
  // wiped still has a record of what went. Null on a sealed one: the bird did
  // not open it and neither does this.
  const body = kind === "SEALED" ? null : held.tag.paperText.trim();

  // The only Request with no reason box — the letter IS the record, clipped
  // to what the Request/AuditLog reason columns hold.
  const reason = (body ?? `Sealed: ${held.tag.name}`).slice(
    0,
    MAX_REASON_LENGTH,
  );

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is currently open.");

  // No bird will fly into or out of the deep caves.
  if (!character.zoneId)
    throw new UserError("You aren't anywhere a bird could leave from.");
  const fromZone = await prisma.zone.findUnique({
    where: { id: character.zoneId },
  });
  if (!isBirdReachableZone(fromZone)) {
    throw new UserError("No bird will fly down here.");
  }

  const guessedZone = await prisma.zone.findUnique({
    where: { id: guessedZoneId ?? "" },
  });
  if (!guessedZone) throw new UserError("Unknown destination.");
  if (!isBirdReachableZone(guessedZone)) {
    throw new UserError("No bird will fly down there.");
  }

  if (!recipientId || recipientId === character.id) {
    throw new UserError("Pick someone other than yourself.");
  }
  // Deliberately NOT filtered to the living — narrowing here would make a
  // rejection a working test for whether someone has died.
  const recipient = await prisma.character.findUnique({
    where: { id: recipientId },
    include: { tags: { include: { tag: true } } },
  });
  if (!recipient) throw new UserError("Nobody by that name.");

  const delivered =
    recipient.status === "ALIVE" && recipient.zoneId === guessedZone.id;
  // Only whether they can WRITE BACK. Reading the letter is no longer this
  // action's business — the paper is the letter, and whether they can read it
  // is answered every time they look at it (db/lib/paper.js).
  const recipientIsLiterate = canReadLetters(recipient.tags);

  // In-game DAY, not a turn id — two turns run per day, and keying on the
  // turn would hand out two letters a day. (The mount's claim shared this trap
  // until it became a per-turn allowance — CARRY.md §2a.)
  const dayKey = String(describeTurn(openTurn).day);

  // A Rookery standing where they are raises the day's allowance and puts a
  // three-minute clock between flights (db/lib/rookery.js). No literacy check
  // here: canSendBird above already requires it, so an illiterate character
  // never reaches this line at all.
  const allowance = birdAllowanceFrom(
    await structuresAt(prisma, character.locationId, { statuses: WORKING_STATUSES }),
  );
  // Only consulted when a building is doing something. The ordinary
  // once-a-day bird needs no cooldown — the day IS the cooldown.
  if (allowance > BASE_BIRD_SENDS_PER_DAY) {
    const cooling = rookeryCooldown(character.birdLastSentAt);
    if (!cooling.ok) {
      throw new UserError(`Try again <t:${cooling.readyAt}:R>.`);
    }
  }

  let birdMessageId = null;
  await prisma.$transaction(async (tx) => {
    // The claim, in the shape it has always had: a conditional updateMany
    // whose WHERE is the check, so two tabs racing cannot both spend the last
    // flight. It is two writes now rather than one because the day has a
    // COUNT against it — the first resets a stale day, the second spends
    // inside a live one, and exactly one of them can match.
    const opened = await tx.character.updateMany({
      where: {
        id: character.id,
        OR: [{ birdTurnId: null }, { birdTurnId: { not: dayKey } }],
      },
      data: { birdTurnId: dayKey, birdDaySends: 1, birdLastSentAt: new Date() },
    });
    if (opened.count === 0) {
      const spent = await tx.character.updateMany({
        where: {
          id: character.id,
          birdTurnId: dayKey,
          birdDaySends: { lt: allowance },
        },
        data: { birdDaySends: { increment: 1 }, birdLastSentAt: new Date() },
      });
      if (spent.count === 0) {
        throw new UserError(
          allowance > BASE_BIRD_SENDS_PER_DAY
            ? "The birds have all flown today."
            : "Your bird has already flown today.",
        );
      }
    }

    const row = await tx.birdMessage.create({
      data: {
        senderId: character.id,
        senderName: character.name,
        senderDiscordUserId: character.discordUserId ?? null,
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientDiscordUserId: recipient.discordUserId ?? null,
        guessedZoneId: guessedZone.id,
        guessedZoneName: guessedZone.name,
        tagId: held.tagId,
        tagName: held.tag.name,
        body,
        delivered,
        arrivalTurnId: delivered ? openTurn.id : null,
        // Arrival turn PLUS ONE, so a letter sent minutes before turn close
        // is still answerable.
        replyDeadlineTurn: delivered ? openTurn.number + 1 : null,
      },
    });
    birdMessageId = row.id;

    // THE LETTER ONLY LEAVES YOUR HANDS IF IT ARRIVES. A wrong guess means the
    // bird comes back with it still tied on, and the sender is told a turn
    // later like always. Burning a player's letter as the price of a bad guess
    // would be a second punishment nobody was warned about — and the guess
    // already costs them the day's send.
    if (delivered) {
      await dropCharacterTag(tx, character.id, held.tagId, 1);
      await addToStack(tx, recipient.id, held.tagId, 1, {});
    }

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_bird_message",
      targetCharacterId: recipient.id,
      details: {
        recipientId: recipient.id,
        guessedZoneId: guessedZone.id,
        delivered,
        birdMessageId: row.id,
      },
    });
  });

  // Post-commit — a DM must not hold up or undo the write (ARCHITECTURE.md §5).
  notifyCharacter(
    character,
    sentReceiptDm({
      recipientName: recipient.name,
      zoneName: guessedZone.name,
      letterName: held.tag.name,
    }),
    { source: "bird" },
  );
  if (delivered) {
    notifyCharacter(
      recipient,
      deliveryDm({ senderName: character.name, letterName: held.tag.name }),
      {
        // No Reply button for someone who can't write one — birdReply.js
        // re-checks, since a GM can strip the tag inside the window.
        components: recipientIsLiterate
          ? replyButtonRow(birdMessageId)
          : undefined,
        meta: { kind: "bird", birdMessageId, letterName: held.tag.name },
        source: "bird",
      },
    );
    await afterInventoryChange([character.id, recipient.id]);
  }

  revalidateAll();
  return { ok: true };
}

export async function extractGodfleshRequest(input) {
  return guarded(() => extractGodfleshRequestImpl(input));
}

export async function packageItemsRequest(input) {
  return guarded(() => packageItemsRequestImpl(input));
}

export async function birdMessageRequest(input) {
  return guarded(() => birdMessageRequestImpl(input));
}

// ---- The Raven Draught ---------------------------------------------------
//
// The second crossing of zone isolation, after the Bird (docs/systemdocs/
// BIRD.md). A brewed bottle, spent on one sentence to one person anywhere in
// Ravenheart, with no guess to get right and no reply coming back.
//
// It is allowed to be certain where the Bird is not, and the reason is the
// whole of BIRD.md §2: the Bird's delayed, identically-worded failure exists
// so nobody can use it to ask "is this person alive". This asks nothing. It
// reports "Sent." every single time — to the living, to the dead, to somebody
// who logged off in week one — so the sender learns exactly nothing they did
// not already know. The truth goes in the audit row, for a GM, and nowhere a
// player can read it.
//
// Declared here rather than in db/lib for the reason MULLIGAN_SLUG gives: one
// bespoke consumable, one place that names it.
const RAVEN_DRAUGHT_SLUG = "raven-draught";

// Bascinet's words, verbatim, so no dagger.
function whisperDm(message) {
  return `You hear a whisper in your mind: ${message}`;
}

async function whisperRequestImpl({ recipientId, message: rawMessage }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const held = character.tags.find(
    (ct) => ct.tag.slug === RAVEN_DRAUGHT_SLUG && ct.quantity > 0,
  );
  if (!held) throw new UserError("You aren't carrying a Raven Draught.");

  const message = String(rawMessage ?? "").trim().slice(0, WHISPER_MAX);
  if (!message) throw new UserError("Say something first.");

  const targetId = String(recipientId ?? "");
  if (!targetId) throw new UserError("Pick someone.");
  if (targetId === character.id) {
    throw new UserError("You already know what you were going to say.");
  }
  // Loaded WITHOUT a status filter, the way the Bird loads its recipient: a
  // query that could only find the living would answer the question this
  // whole action is built not to answer.
  const recipient = await prisma.character.findUnique({
    where: { id: targetId },
    select: { id: true, name: true, status: true, discordUserId: true },
  });
  if (!recipient) throw new UserError("Nobody by that name.");

  const delivered = recipient.status === "ALIVE";
  const openTurn = await getOpenTurn();
  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity: 1,
  };

  await prisma.$transaction(async (tx) => {
    // The bottle was read outside this transaction — lock before spending it,
    // or two submits in flight both see one draught and send two whispers.
    await lockCharacter(tx, character.id);
    const stillHeld = await tx.characterTag.findFirst({
      where: { characterId: character.id, tagId: held.tagId, quantity: { gt: 0 } },
      select: { id: true },
    });
    if (!stillHeld) throw new UserError("You aren't carrying a Raven Draught.");
    await dropCharacterTag(tx, character.id, held.tagId, 1);
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_whisper",
      targetCharacterId: recipient.id,
      turnId: openTurn?.id ?? null,
      details: {
        restore,
        recipientId: recipient.id,
        recipientName: recipient.name,
        message,
        // The one place the outcome is written down. The sender is never told.
        delivered,
      },
    });
  });

  // Post-commit, and only to somebody alive to hear it (ARCHITECTURE.md §5).
  if (delivered) {
    notifyCharacter(recipient, whisperDm(message), { source: RAVEN_DRAUGHT_SLUG });
  }

  await afterInventoryChange(character.id);
  revalidateAll();
  // Identical either way. See the note at the top of this section.
  return { ok: true };
}

// ---- The Stepstone -------------------------------------------------------
//
// A raw relocation, the shape the Dev Panel's Teleport already uses: no Move
// cost, no adjacency, no cooldown, immediate. It reaches anywhere on the
// SURFACE, known or not — the fog behind /map no longer narrows it. The one
// standing limit is the underground: a CAVE_LEVEL zone is never a target, so
// the stone cannot drop somebody past the caving gate into the dark.
const STEPSTONE_SLUG = "stepstone";

async function stepstoneRequestImpl({ locationId }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const held = character.tags.find(
    (ct) => ct.tag.slug === STEPSTONE_SLUG && ct.quantity > 0,
  );
  if (!held) throw new UserError("You aren't carrying a Stepstone.");

  // A hold stops a walk at locationTravel.js#performLocationMove, and it has to
  // stop a step for the same reason: an ambush is a hand on your shoulder
  // (docs/systemdocs/INTERCEPT.md). Without this the stone is the one way out
  // of an intercept in the game.
  const heldBy = heldReasonFor(character);
  if (heldBy) throw new UserError(heldBy);

  // And an unresolved Caving 1 stops it for the same reason one step further
  // on (docs/systemdocs/CAVING.md §2c). The stone only ever lands on the
  // SURFACE, so used from underground it is exactly the crossing the hold
  // exists to refuse — without this it is the one way out of the dark.
  const cavingHold = await cavingHoldFor(prisma, character.id, character.zoneId);
  if (cavingHold) throw new UserError(cavingHold);

  const targetId = String(locationId ?? "");
  if (!targetId) throw new UserError("Pick somewhere.");
  if (character.locationId === targetId) {
    throw new UserError("You're already there.");
  }

  const location = await prisma.location.findUnique({
    where: { id: targetId },
    include: { zone: true },
  });
  if (!location) throw new UserError("There's no such place.");

  // Re-checked here rather than trusted from the dialog: the picker is a hint,
  // and a posted id for a cave level must be refused whatever the client drew.
  //
  // SURFACE only. CAVE_LEVEL is the underground, and CAVE_GROUP is not a place
  // anybody stands (db/prisma/schema.prisma, ZoneKind) — testing for SURFACE
  // rather than listing the two keeps a new kind out by default, which is the
  // safe direction for a refusal.
  if (location.zone?.kind !== "SURFACE") {
    throw new UserError("The stone will not carry you underground.");
  }

  const fromLocationId = character.locationId;
  const openTurn = await getOpenTurn();
  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity: 1,
  };

  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);
    const stillHeld = await tx.characterTag.findFirst({
      where: { characterId: character.id, tagId: held.tagId, quantity: { gt: 0 } },
      select: { id: true },
    });
    if (!stillHeld) throw new UserError("You aren't carrying a Stepstone.");
    await dropCharacterTag(tx, character.id, held.tagId, 1);
    await tx.character.update({
      where: { id: character.id },
      data: {
        locationId: location.id,
        // Denormalized mirror — every writer of locationId writes both.
        zoneId: location.zoneId,
        // A crossing already declared would otherwise walk them off again at
        // the next close, and an escort you have vanished out of is over.
        travelToLocationId: null,
        travelTurnId: null,
        escortedById: null,
      },
    });
    // Nobody follows a stone. Cut the party loose here rather than leaving
    // them pointed at somebody standing in another zone — the same tidy-up
    // db/lib/characterDeath.js does when a leader leaves play. Left dangling,
    // partyOf() still counts them and can cost a mounted leader the horse's
    // extra crossing for followers who are nowhere near them.
    await tx.character.updateMany({
      where: { escortedById: character.id },
      data: { escortedById: null },
    });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_stepstone",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: {
        restore,
        fromLocationId,
        toLocationId: location.id,
        toLocationName: location.name,
        toZoneName: location.zone?.name ?? null,
      },
    });
  });

  // Post-commit and out of band: this is the one hook every writer of
  // locationId owes — the map row, the channel overwrite, the zone role, the
  // carry settle, the corpses being carried, the poke at every open /chat.
  // Discord must never be touched from inside a transaction.
  after(async () => {
    try {
      await applyLocationMoveSideEffects(prisma, {
        characterId: character.id,
        fromLocationId,
        toLocationId: location.id,
      });
    } catch (err) {
      console.error("Stepstone: location side effects failed:", err);
    }
    // Walking is what wakes the dark, and stepping counts as arriving.
    try {
      const moved = await prisma.character.findUnique({ where: { id: character.id } });
      const cavingDm = await rollCavingOnArrival(prisma, moved, location);
      if (cavingDm) {
        await sendDm(cavingDm.discordUserId, cavingDm.content).catch((err) =>
          console.error("Stepstone: caving arrival DM failed:", err),
        );
      }
    } catch (err) {
      console.error("Stepstone: caving roll failed:", err);
    }
  });

  revalidateAll();
  return { ok: true, locationName: location.name, zoneName: location.zone?.name ?? null };
}

export async function whisperRequest(input) {
  return guarded(() => whisperRequestImpl(input));
}

export async function stepstoneRequest(input) {
  return guarded(() => stepstoneRequestImpl(input));
}

