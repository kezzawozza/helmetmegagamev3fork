// The Trinket turn-end pass (docs/systemdocs/TRINKETS.md), run from
// db/index.js#resolveNeeds() alongside Lessons/Research/Confessions — order
// doesn't matter, they share no state.
//
// Every OPEN Trinket Gambit is rolled here: the stored die face, clamped up
// by the skilled floor, mapped to a tier and base sell price (TRINKETS.md
// §1). Ingredient value is added, the Trinket is minted with mintCustomCraft
// (db/lib/customCraftMint.js), and the Action marked SOLVED with a reveal DM.
//
// DELIBERATELY does not touch db/lib/gambitModifier.js — the skilled floor
// is a flat promise ("a trained smith never rolls worse than Normal"), and
// folding in Hunger/mood via `Action.diceModifier` could knock it back down
// on exactly the turns it matters most. Reads `diceRoll` alone.
//
// Returns Discord work as data, never sends it (db/lib/offerExpiryPass.js's
// contract); a null return is a failed pass to retry.
const { SMITHING_SKILLED_SLUG } = require("./constants");
const { mintCustomCraft } = require("./customCraftMint");
const { addToStack } = require("./tagWrites");

const TRINKET_GMNOTES = "auto:trinket";

// Face -> tier (TRINKETS.md §1). Index 0 is unused (a d6 never rolls it).
const TIERS = [
  null,
  { name: "Awful", price: 5 },
  { name: "Poor", price: 8 },
  { name: "Normal", price: 14 },
  { name: "Good", price: 22 },
  { name: "Excellent", price: 34 },
  { name: "Masterwork", price: 60 },
];

// A smith holding {tag:smithing-skilled} never rolls Awful or Poor.
// Exported for the test file to check in isolation (no prisma needed).
function clampFace(face, heldSlugs) {
  if (heldSlugs?.has(SMITHING_SKILLED_SLUG) && face < 3) return 3;
  return face;
}

function tierFor(face) {
  return TIERS[face] ?? TIERS[3];
}

async function runTrinketPass(prisma, turn) {
  const idle = { turnNumber: turn.number, resolved: 0, failed: 0, dms: [] };
  const actions = await prisma.action.findMany({
    where: {
      turnId: turn.id,
      moveKind: "GAMBIT",
      moveReviewStatus: "OPEN",
      gmNotes: { contains: TRINKET_GMNOTES },
    },
  });
  if (actions.length === 0) return idle;

  const baseTag = await prisma.tag.findUnique({ where: { slug: "trinket" } });
  if (!baseTag) {
    // Catalog row missing: every filed Trinket fails together, retries next close.
    console.error('Trinket pass: no {tag:trinket} catalog row — is docs/tags.yaml synced?');
    return { turnNumber: turn.number, resolved: 0, failed: actions.length, dms: [] };
  }

  let resolved = 0;
  let failed = 0;
  const dms = [];

  for (const action of actions) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const character = await tx.character.findUnique({
          where: { id: action.characterId },
          select: {
            id: true,
            name: true,
            status: true,
            discordUserId: true,
            tags: { select: { tag: { select: { slug: true } } } },
          },
        });
        // A GM deleted the Move, or the character died — nothing to resolve.
        if (!character) return null;

        const heldSlugs = new Set(character.tags.map((ct) => ct.tag?.slug).filter(Boolean));
        const face = clampFace(action.diceRoll ?? 1, heldSlugs);
        const tier = tierFor(face);

        const details = action.craftBudget ?? {};
        const ingredientSlugs = Array.isArray(details.ingredientSlugs) ? details.ingredientSlugs : [];
        const inlayRows = ingredientSlugs.length
          ? await tx.tag.findMany({
              where: { slug: { in: ingredientSlugs } },
              select: { slug: true, inlayValue: true, gambitBonus: true },
            })
          : [];
        const inlaySum = inlayRows.reduce((sum, t) => sum + (t.inlayValue ?? 0), 0);
        const price = tier.price + inlaySum;
        // The Arkenstone's +1 (TRINKETS.md) rides onto the minted clone the
        // same way its inlayValue rides onto the price. Summed like the price
        // is, but in practice never more than one: resolveIngredientSlots
        // refuses the same slug twice ("You've put the same ingredient in
        // twice"), and the Arkenstone is the only tag in the catalog carrying
        // the column. Two SEPARATE Arkenstone Trinkets do stack, because
        // db/lib/gambitModifier.js adds one entry per held tag.
        //
        // Null rather than 0 when nothing contributed, so gambitModifier.js
        // has nothing to find on an ordinary Trinket.
        const gambitBonus = inlayRows.reduce((sum, t) => sum + (t.gambitBonus ?? 0), 0) || null;

        const composedName = details.name || `${tier.name} Trinket`;
        const composedDescription = details.description || baseTag.description;

        // Tier joins the dedup key: same tier + ingredients stack onto one
        // custom row, but a Good and a Masterwork off the same inlay must
        // NOT collide and inherit the wrong price.
        const cookedFrom = [...ingredientSlugs, `tier:${tier.name.toLowerCase()}`].sort();

        const { tag: minted } = await mintCustomCraft(tx, baseTag, {
          name: composedName,
          description: composedDescription,
          literal: true,
          cookedFrom,
          sellablePriceOverride: price,
          gambitBonusOverride: gambitBonus,
        });

        await addToStack(tx, character.id, minted.id, 1, { source: "CRAFT", stackable: true });

        const resultMessage = `Made ${minted.name} at the forge (${tier.name}, worth ${price} ⬢).`;
        await tx.action.update({
          where: { id: action.id },
          data: { moveReviewStatus: "SOLVED", reviewedAt: new Date(), resultMessage },
        });

        return { character, tier, price, itemName: minted.name, face, gambitBonus };
      });
      if (!outcome) continue;
      resolved += 1;
      if (outcome.character.discordUserId && outcome.character.status === "ALIVE") {
        dms.push({
          discordUserId: outcome.character.discordUserId,
          content: [
            `🎲 Your Gambit for turn ${turn.number}: **${outcome.face}**.`,
            `The forge gives you a **${outcome.tier.name}** Trinket: **${outcome.itemName}** (worth ${outcome.price} ⬢ to the merchant).`,
            outcome.gambitBonus
              ? `-# Something in it answers you. While you carry it, your Gambit die is +${outcome.gambitBonus}.`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        });
      }
    } catch (err) {
      failed += 1;
      console.error(`Trinket ${action.id} failed to resolve:`, err);
    }
  }

  return { turnNumber: turn.number, resolved, failed, dms };
}

module.exports = { runTrinketPass, clampFace, tierFor, TIERS };
