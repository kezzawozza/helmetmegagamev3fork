// Custom craftables (CRAFTING.md): a `customizable` recipe may be crafted as a player-named item for
// a surcharge. The ONE place deciding what counts as customized and what it costs, shared by the
// dialog and the server action so the two can never drift. Pure — no prisma, no React.

import { cleanCustomText } from "@lifeweb/db/lib/customText";

export const CUSTOM_SURCHARGE = 1; // ⬢ per unit, on top of the recipe's own

// What THIS recipe charges for the player's words. A recipe may buy it out with `custom: { cost: 0 }`
// in docs/tags.yaml (both meals do — COOKING.md). One verdict, both sides.
export function surchargeFor(tag) {
  return tag?.customCost ?? CUSTOM_SURCHARGE;
}

// The whole custom-words verdict for one recipe: what the words amount to after cleaning, and what
// they cost. One shared verdict instead of four call sites pricing it by hand.
export function customCraftFor(tag, fields) {
  const custom = tag?.customizable
    ? customCraftFields({
        customName: fields?.customName,
        // A recipe may take a name and no words (Fine Meal, COOKING.md); a stray description is
        // dropped rather than refused — a hidden textarea is a hint, not an attack.
        customDescription: tag.customDescribable === false ? "" : fields?.customDescription,
      })
    : { name: "", description: "", active: false };
  return { custom, surcharge: custom.active ? surchargeFor(tag) : 0 };
}
export const CUSTOM_NAME_MAX = 30;
export const CUSTOM_DESCRIPTION_MAX = 300;
export const INSCRIPTION_MAX = 200;

// Player-authored text, defanged — see db/lib/customText.js. Lives there, not here, because the bot
// needs the same scrubber and cannot reach into web/.
export { cleanCustomText };

// The single verdict both sides use: the cleaned fields, and whether this
// craft is customized at all (either field non-empty after cleaning).
export function customCraftFields({ customName, customDescription } = {}) {
  const name = cleanCustomText(customName, CUSTOM_NAME_MAX);
  const description = cleanCustomText(customDescription, CUSTOM_DESCRIPTION_MAX);
  return { name, description, active: Boolean(name || description) };
}

// WHO may customize this recipe. `Tag.customizableSkillSlug` names a tag the character must hold
// (e.g. `smithing-skilled` on arms and armour). No gate means open to anyone who can make it. No
// ancestry walk needed: `smithing-gunpowder` carries `smithing-skilled` as a requiredTag already.
export function mayCustomize(tag, heldSlugs) {
  if (!tag?.customizable) return false;
  if (!tag.customizableSkillSlug) return true;
  return Boolean(heldSlugs?.has(tag.customizableSkillSlug));
}

// Displayed name always carries the base identity — "Steak Dinner (Lavish Meal)" — so a custom name
// can never impersonate another item. Description-only custom keeps "(custom)" so Tag.name's
// @unique never collides with the base row.
export function customCraftName(baseName, name) {
  return name ? `${name} (${baseName})` : `${baseName} (custom)`;
}
