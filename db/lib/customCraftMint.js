// The custom-craft mint (docs/systemdocs/CRAFTING.md, COOKING.md,
// TRINKETS.md): a `customizable` recipe crafted with player words — or a
// Trinket, whose "words" are the tier the die handed back — clones the base
// catalog row into a fresh custom + ephemeral tag and the craft grants THAT
// row instead of the base one.
//
// Lives in db/lib rather than web/ because BOTH faces need it now: the web
// Craft dialog (web/app/(app)/character/requestActions.js#mintCustomCraft,
// now a thin UserError-wrapping shim around this) and the Trinket turn-end
// pass (db/lib/trinketPass.js), which runs from db/index.js#resolveNeeds()
// and can never require anything under web/ — that direction of dependency
// does not exist anywhere in this codebase, and a turn pass is not the place
// to start it. See CLAUDE.md: "If both faces need something, put it in
// db/lib/ — don't write it twice."
//
// Throws a plain Error on the rare "no free name" collision — there is no
// UserError down here, since db/lib has no notion of a web request. The web
// wrapper is what turns that into one.
const { createWithRetry } = require("./paperMint");

// "(Name)" for a player-worded custom craft — the mint-time copy of
// web/lib/customCraft.js#customCraftName, kept here because that module is
// ESM and web-only (it also pulls in cleanCustomText, which this file must
// not need: the words arrive ALREADY cleaned, at request time, by whichever
// side is calling in). Two copies of one formatting rule is a real cost, but
// the alternative — db/lib requiring an ESM file under web/ — is the thing
// this whole module exists to avoid. If this drifts from
// web/lib/customCraft.js, that is a bug to fix in both places at once.
function customCraftName(baseName, name) {
  return name ? `${name} (${baseName})` : `${baseName} (custom)`;
}

// "(rich spices)" for a dish nobody named, or "" when it has no ingredients
// or none of them taste of anything. `cookedTastes` is the caller's lookup,
// already loaded — this must not query.
function cookedTasteSuffix(cookedFrom, cookedTastes) {
  const tastes = (cookedFrom ?? []).map((slug) => cookedTastes?.get(slug) ?? "").filter(Boolean);
  return tastes.length ? ` (${tastes.join(", ")})` : "";
}

// The finished thing lands on the sheet: the replaced tiers come off (caller's
// job), the tag goes on with its clock, and the ADD_TAG request records all of
// it. Runs OUTSIDE the craft transaction, deliberately — see the comment this
// carried at its old home in requestActions.js for the full "why now, why
// dedup on words+ingredients" story; unchanged here.
//
// `sellablePriceOverride` is Trinket's own door onto this: a minted Trinket's
// sell price is computed by db/lib/trinketPass.js from the die and the
// ingredients, and has nothing to do with `baseTag.sellablePrice` (the never-
// minted {tag:trinket} catalog row's own placeholder). Every other caller
// omits it and gets the old behavior — `baseTag.sellablePrice` copied
// straight across, same as before this parameter existed.
async function mintCustomCraft(
  db,
  baseTag,
  { name, description, literal = false, cookedFrom = [], cookedTastes = null, sellablePriceOverride },
) {
  const tasteSuffix = literal ? "" : cookedTasteSuffix(cookedFrom, cookedTastes);
  const composedName = literal
    ? name
    : name || description
      ? customCraftName(baseTag.name, name)
      : `${baseTag.name}${tasteSuffix}`;
  const composedDescription = description || baseTag.description;
  const key = [...cookedFrom].sort();
  const existing = await db.tag.findFirst({
    where: {
      custom: true,
      ephemeral: true,
      name: composedName,
      description: composedDescription,
      cookedFrom: { equals: key },
    },
  });
  if (existing) return { tag: existing, minted: false };
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  const tag = await createWithRetry(db, (attempt) => ({
    slug: `custom-craft-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`,
    name: attempt ? `${composedName} (${attempt + 1})` : composedName,
    description: composedDescription,
    custom: true,
    ephemeral: true,
    craftable: false,
    customizable: false,
    pointCost: 0,
    category: baseTag.category,
    groupId: baseTag.groupId ?? null,
    tradeable: baseTag.tradeable,
    weightLbs: baseTag.weightLbs,
    stackable: baseTag.stackable,
    inspectVisibility: baseTag.inspectVisibility,
    equippable: baseTag.equippable,
    equipSlot: baseTag.equipSlot,
    equipLayer: baseTag.equipLayer,
    twoHanded: baseTag.twoHanded,
    customOfSlug: baseTag.slug,
    fighting: baseTag.fighting ?? undefined,
    meleeArmor: baseTag.meleeArmor,
    ballisticArmor: baseTag.ballisticArmor,
    concealsIdentity: baseTag.concealsIdentity,
    forcesConceal: baseTag.forcesConceal,
    concealSprite: baseTag.concealSprite,
    laborBonus: baseTag.laborBonus ?? undefined,
    carryBonus: baseTag.carryBonus,
    removable: baseTag.removable,
    consumable: baseTag.consumable,
    consumesInto: baseTag.consumesInto,
    consumesIntoOneOf: baseTag.consumesIntoOneOf ?? undefined,
    consumesIntoUnless: baseTag.consumesIntoUnless ?? undefined,
    consumesIntoDurations: baseTag.consumesIntoDurations ?? undefined,
    consumesIntoResources: baseTag.consumesIntoResources,
    cookedFrom: key,
    mealMood: baseTag.mealMood,
    sellable: baseTag.sellable,
    sellablePrice: sellablePriceOverride ?? baseTag.sellablePrice,
    defaultDurationTurns: baseTag.defaultDurationTurns,
    expiresInto: baseTag.expiresInto ?? undefined,
  }));
  if (!tag)
    throw new Error("Couldn't find a free name for that — try different words.");
  return { tag, minted: true };
}

// Best-effort undo of a mint whose craft transaction failed: the guard on
// `custom` means this can never touch a catalog row, and a row somebody
// already holds is FK-pinned and simply survives (prune's problem, not
// ours). Failures are swallowed — the craft's own error is the one to show.
async function unmintCustomCraft(db, grant) {
  if (!grant?.minted) return;
  await db.tag
    .deleteMany({ where: { id: grant.tag.id, custom: true, ephemeral: true } })
    .catch(() => {});
}

module.exports = {
  mintCustomCraft,
  unmintCustomCraft,
  customCraftName,
};
