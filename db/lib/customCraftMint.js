// The custom-craft mint (CRAFTING.md, COOKING.md, TRINKETS.md): clones the
// base catalog row into a fresh custom + ephemeral tag for a `customizable`
// recipe crafted with player words (or a Trinket, whose "words" are the die's
// tier); the craft grants THAT row instead of the base one. Lives in db/lib
// because BOTH faces need it: the web Craft dialog and the Trinket turn-end
// pass (db/lib/trinketPass.js), which runs from resolveNeeds() and can never
// require anything under web/. Throws a plain Error on the rare "no free
// name" collision — no UserError down here; the web wrapper converts it.
const { createWithRetry } = require("./paperMint");

// Mint-time copy of web/lib/customCraft.js#customCraftName, kept here since
// that module is ESM/web-only (words arrive ALREADY cleaned at request time).
// If this drifts from web/lib/customCraft.js, fix both places at once.
function customCraftName(baseName, name) {
  return name ? `${name} (${baseName})` : `${baseName} (custom)`;
}

// "(rich spices)" for an unnamed dish, or "" when nothing tastes of anything.
// `cookedTastes` is the caller's already-loaded lookup — this must not query.
function cookedTasteSuffix(cookedFrom, cookedTastes) {
  const tastes = (cookedFrom ?? []).map((slug) => cookedTastes?.get(slug) ?? "").filter(Boolean);
  return tastes.length ? ` (${tastes.join(", ")})` : "";
}

// Runs OUTSIDE the craft transaction, deliberately. `sellablePriceOverride`
// is Trinket's own door onto this: its sell price is computed by
// db/lib/trinketPass.js from the die and ingredients, unrelated to
// `baseTag.sellablePrice` (the never-minted placeholder row). Every other
// caller omits it and gets `baseTag.sellablePrice` copied straight across.
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

// Best-effort undo when the craft transaction failed. `custom` guard means
// this can never touch a catalog row; an already-held row is FK-pinned and
// survives (prune's problem, not ours). Failures swallowed — the craft's own error is shown instead.
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
