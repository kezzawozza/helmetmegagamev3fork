"use server";

// Trinket, from the forge (docs/systemdocs/TRINKETS.md). Files a whole-Move
// GAMBIT the same shape as a lesson's learner side (db/lib/lessons.js) or a
// confession (db/lib/confession.js), and db/lib/trinketPass.js resolves it
// at turn end.
//
// DELIBERATELY NOT the normal Craft dialog / craftRequestImpl path. A Trinket
// is a Gambit whose whole point is that the smith does not know what they are
// about to get — the Craft dialog shows exactly what a recipe makes before you
// press the button, which would spoil the die before it is even rolled. So
// there is no {tag:trinket} entry in the Craft dialog's recipe list; this is
// its own entry point, and {tag:trinket} in docs/tags.yaml is `catalog: none`,
// `craftable: false` — it exists only as the base shape mintCustomCraft clones
// from once the die is cast, not as something anyone crafts through the usual
// door. Because of that, the recipe's own gate (smithing, a forge, the
// resource cost) is re-implemented here as plain constants rather than read
// off that row's `requirement` block, which it deliberately does not carry.
//
// `requirement.gambit` in docs/tags.yaml, and the `requirementGambit` column
// it writes, are the CURE-only flag documented on Tag.requirementGambit in
// schema.prisma — crafting never reads it (CRAFTING.md: "gambit is ignored").
// Trinket does not touch that flag at all; it does not need to, since it
// never goes near craftRequestImpl in the first place.
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { hasEquipmentInReach } from "@lifeweb/db/lib/equipmentReach";
import { WORKSHOP_EQUIPMENT_SLUG } from "@lifeweb/db/lib/constants";
import { rollWithAdvantage } from "@lifeweb/db/lib/advantage";
import { dropCharacterTag, debitResources } from "@/lib/tagEffects";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";
import { buildSkillAncestry, satisfiedSkillIds } from "@lifeweb/db/lib/medicalVision";
import { cleanCustomText, CUSTOM_NAME_MAX, CUSTOM_DESCRIPTION_MAX } from "@/lib/customCraft";
import { resolveIngredientSlots, resolveCraftPayer } from "./requestActions";

// The recipe's own numbers (TRINKETS.md §1), authored as constants here
// rather than read off {tag:trinket}.requirement — see the file header for
// why that row deliberately does not carry one.
const TRINKET_RESOURCE_COST = 4;
const SMITHING_SLUG = "smithing";
const INGREDIENT_SLOTS = { min: 0, max: 2 };
const GMNOTES = "auto:trinket";

const TRINKET_SELECT = {
  id: true,
  name: true,
  status: true,
  locationId: true,
  zoneId: true,
  discordUserId: true,
  tags: {
    select: {
      tagId: true,
      quantity: true,
      tag: { select: { id: true, slug: true, name: true, parentTagId: true, inlayValue: true } },
    },
  },
};

async function me() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: TRINKET_SELECT,
  });
  if (!character) redirect("/character");
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) throw new UserError(`You can't work the forge right now — you're ${blocker.name}.`);
  return { session, character };
}

// Smithing, or a higher tier of it (Skilled, Gunpowder) — same tier-walk
// every other recipe skill gate uses.
async function requireSmithing(character) {
  const catalog = await prisma.tag.findMany({ select: { id: true, slug: true, parentTagId: true } });
  const bySlug = new Map(catalog.map((t) => [t.slug, t]));
  const smithing = bySlug.get(SMITHING_SLUG);
  if (!smithing) throw new UserError("Making a Trinket needs Smithing.");
  const ancestry = buildSkillAncestry(catalog);
  const satisfied = satisfiedSkillIds(character.tags.map((ct) => ct.tagId), ancestry);
  if (!satisfied.has(smithing.id)) throw new UserError("Making a Trinket needs Smithing.");
}

async function requireWorkshop(character) {
  if (await hasEquipmentInReach(prisma, character, WORKSHOP_EQUIPMENT_SLUG)) return;
  throw new UserError(
    "Making a Trinket is smith's work: hold Workshop Equipment, or stand somewhere a set is already put up.",
  );
}

async function requireFreeMoveForGambit(character, openTurn) {
  if (!openTurn) throw new UserError("No turn is open.");
  const { locked } = moveWindow(openTurn, { clockFrozen: await clockFrozen(prisma) });
  if (locked) throw new UserError("Moves are locked for this turn.");
  const acted = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true },
  });
  if (acted) throw new UserError("You've already used your Move this turn.");
}

async function trinketRequestImpl({ name, description, ingredientSlugs }) {
  const { session, character } = await me();
  await requireSmithing(character);
  await requireWorkshop(character);

  const openTurn = await getOpenTurn();
  await requireFreeMoveForGambit(character, openTurn);

  // Same words-cleaning cooking's custom craft uses — a name is optional, and
  // an unnamed Trinket is simply named after its tier at turn end.
  const cleanName = cleanCustomText(name, CUSTOM_NAME_MAX);
  const cleanDescription = cleanCustomText(description, CUSTOM_DESCRIPTION_MAX);

  // Trinket's OWN ingredient pool — every tag carrying `inlayValue`, never
  // `cooked` (that's cooking's separate pool; see the comment on
  // resolveIngredientSlots in requestActions.js).
  const posted = (Array.isArray(ingredientSlugs) ? ingredientSlugs : [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  const inlayRows = posted.length
    ? await prisma.tag.findMany({
        where: { slug: { in: posted }, inlayValue: { not: null } },
        select: { slug: true, name: true, inlayValue: true },
      })
    : [];
  const inlayBySlug = new Map(inlayRows.map((t) => [t.slug, t]));
  // resolveIngredientSlots takes { min, max } off the recipe's own
  // `requirement.ingredientSlots` normally; Trinket has no such row, so the
  // { min: 0, max: 2 } from TRINKETS.md is passed as a stand-in tag shape.
  const slotPlan = await resolveIngredientSlots(
    character,
    { requirementIngredientSlots: INGREDIENT_SLOTS },
    1,
    posted,
    inlayBySlug,
  );

  const cost = TRINKET_RESOURCE_COST;
  const payer = await resolveCraftPayer(character, `character:${character.id}`, cost);

  const diceRoll = rollWithAdvantage(character.tags).die;

  let action;
  try {
    action = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${character.id} FOR UPDATE`;
      for (const line of slotPlan.spend) {
        const row = await tx.characterTag.findUnique({
          where: { characterId_tagId: { characterId: character.id, tagId: line.tagId } },
        });
        if (!row || row.quantity < line.quantity) {
          throw new UserError(`You don't have enough ${line.tagName} left for that.`);
        }
        await dropCharacterTag(tx, character.id, line.tagId, line.quantity);
      }
      await debitResources(tx, payer, cost);
      const created = await tx.action.create({
        data: {
          characterId: character.id,
          turnId: openTurn.id,
          type: "MOVE",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          moveKind: "GAMBIT",
          moveReviewStatus: "OPEN",
          description: "Working at the forge on a Trinket.",
          // No gambitModifier — see the file header on db/lib/trinketPass.js
          // for why this Gambit deliberately carries no Hunger/mood modifier.
          diceRoll,
          zoneId: character.zoneId ?? null,
          locationId: character.locationId ?? null,
          gmNotes: GMNOTES,
          // Reused for Trinket's own small request payload — the ledger this
          // column normally carries (web/lib moveSpend's craft budget) is
          // keyed off gmNotes containing "auto:craft", which "auto:trinket"
          // never matches, so nothing else that reads craftBudget can
          // mistake this for one.
          craftBudget: {
            kind: "trinket",
            name: cleanName,
            description: cleanDescription,
            ingredientSlugs: slotPlan.cookedFrom,
          },
        },
      });
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_trinket_craft",
        targetCharacterId: character.id,
        turnId: openTurn.id,
        details: {
          cost,
          payer: payer.name,
          ingredientSlugs: slotPlan.cookedFrom,
          name: cleanName,
          description: cleanDescription,
        },
      });
      return created;
    });
  } catch (err) {
    if (err?.code === "P2002") throw new UserError("You've already used your Move this turn.");
    throw err;
  }

  return {
    ok: true,
    line: "You get to work at the forge. You'll see what you made when the turn ends.",
    actionId: action.id,
  };
}

export async function trinketRequest(input) {
  return guarded(() => trinketRequestImpl(input ?? {}));
}
