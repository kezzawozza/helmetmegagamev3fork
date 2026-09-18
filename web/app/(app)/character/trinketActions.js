"use server";

// Trinket, from the forge (TRINKETS.md). Files a whole-Move GAMBIT, same
// shape as a lesson's learner side or a confession; db/lib/trinketPass.js
// resolves it at turn end. DELIBERATELY NOT the normal Craft dialog path — a
// Trinket's whole point is that the smith doesn't know what they'll get, and
// the Craft dialog would spoil the die before it's rolled. {tag:trinket} in
// docs/tags.yaml is `catalog: none`, `craftable: false` — only the base
// shape mintCustomCraft clones from, not something crafted through the usual
// door, so the recipe's gate (smithing, forge, cost) is re-implemented here
// as plain constants rather than read off a `requirement` block it doesn't
// carry. `requirement.gambit`/`requirementGambit` is the CURE-only flag
// (CRAFTING.md: "gambit is ignored") — Trinket never touches it.
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
import { buildSkillAncestry, satisfiedSkillIds } from "@lifeweb/db/lib/medicalVision";
import { cleanCustomText, CUSTOM_NAME_MAX, CUSTOM_DESCRIPTION_MAX } from "@/lib/customCraft";
import { resolveIngredientSlots, resolveCraftPayer } from "./actions/crafting";
import { movesOpen } from "@lifeweb/db/lib/turnGate";

// The recipe's own numbers (TRINKETS.md §1), authored as constants (see file header).
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

// Smithing, or a higher tier — same tier-walk every other recipe skill gate uses.
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
  // One gate, one sentence — db/lib/turnGate.js. It asks about the session BEFORE the lock window, because a frozen clock
  // reports `locked: false` (freezing removes the deadline, it does not shut the game).
  const gate = await movesOpen(prisma, { turn: openTurn });
  if (!gate.ok) throw new UserError(gate.message);
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

  // Same words-cleaning cooking's custom craft uses — an unnamed Trinket is simply named after its tier at turn end.
  const cleanName = cleanCustomText(name, CUSTOM_NAME_MAX);
  const cleanDescription = cleanCustomText(description, CUSTOM_DESCRIPTION_MAX);

  // Trinket's OWN ingredient pool — every tag carrying `inlayValue`, never `cooked` (cooking's separate pool).
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
  // resolveIngredientSlots normally reads { min, max } off the recipe's own row; Trinket has none, so { min: 0, max: 2 } stands in.
  const slotPlan = await resolveIngredientSlots(
    character,
    { requirementIngredientSlots: INGREDIENT_SLOTS },
    1,
    posted,
    inlayBySlug,
  );

  const cost = TRINKET_RESOURCE_COST;
  const payer = await resolveCraftPayer(character, `character:${character.id}`, cost);

  const trinketAdvantage = rollWithAdvantage(character.tags, 6);
  const diceRoll = trinketAdvantage.die;

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
          diceRoll, // no gambitModifier — see db/lib/trinketPass.js header
          zoneId: character.zoneId ?? null,
          locationId: character.locationId ?? null,
          gmNotes: GMNOTES,
          // Reused for Trinket's own payload — moveSpend's craft ledger is
          // keyed off gmNotes containing "auto:craft", which "auto:trinket" never matches.
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
