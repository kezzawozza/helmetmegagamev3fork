// Custom craftables (CRAFTING.md): a `customizable` recipe may be crafted as a player-named item for
// a surcharge. The ONE place deciding what counts as customized and what it costs, shared by the
// dialog and the server action so the two can never drift. Pure — no prisma, no React.

import { cleanCustomText } from "@lifeweb/db/lib/customText";

export const CUSTOM_SURCHARGE = 1; // ⬢ per unit, on top of the recipe's own

export function surchargeFor(tag) {
  return tag?.customCost ?? CUSTOM_SURCHARGE;
}

export function customCraftFor(tag, fields) {
  const custom = tag?.customizable
    ? customCraftFields({
        customName: fields?.customName,
        customDescription: tag.customDescribable === false ? "" : fields?.customDescription,
      })
    : { name: "", description: "", active: false };
  return { custom, surcharge: custom.active ? surchargeFor(tag) : 0 };
}
export const CUSTOM_NAME_MAX = 30;
export const CUSTOM_DESCRIPTION_MAX = 300;
export const INSCRIPTION_MAX = 200;

export { cleanCustomText };

export function customCraftFields({ customName, customDescription } = {}) {
  const name = cleanCustomText(customName, CUSTOM_NAME_MAX);
  const description = cleanCustomText(customDescription, CUSTOM_DESCRIPTION_MAX);
  return { name, description, active: Boolean(name || description) };
}

// The character must hold `Tag.customizableSkillSlug`; no gate means open to anyone.
export function mayCustomize(tag, heldSlugs) {
  if (!tag?.customizable) return false;
  if (!tag.customizableSkillSlug) return true;
  return Boolean(heldSlugs?.has(tag.customizableSkillSlug));
}

// A custom name can never impersonate another item; "(custom)" keeps Tag.name's @unique never colliding with the base row.
export function customCraftName(baseName, name) {
  return name ? `${name} (${baseName})` : `${baseName} (custom)`;
}
