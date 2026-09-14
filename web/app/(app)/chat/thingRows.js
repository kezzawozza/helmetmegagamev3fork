import {
  consumableTags,
  destroyableTags,
  transferableTags,
} from "@/lib/tagRequests";
import { canDetectPoison } from "@lifeweb/db/lib/poison";

// THE THINGS DRAWER's rows. Verbs are the SHEET's own predicates off the
// catalog (TAGS.md §5) via web/lib/tagRequests.js; each re-checks server-side when pressed.
const GROUPS = ["Items", "Assets"];

// Spells db/lib/carry.js#rowWeight a second time (this module is in the
// CLIENT bundle) — keep the two in step with CARRY.md §1; display only, cap settled server-side.
const WEIGHTLESS_CATEGORY = "Assets";

function rowWeightLbs(ct) {
  const tag = ct?.tag;
  if (!tag?.tradeable) return 0;
  if (tag.category === WEIGHTLESS_CATEGORY) return 0;
  return Math.round((tag.weightLbs ?? 0) * (ct.quantity ?? 1) * 100) / 100;
}

// The four verbs for every pocket at once. RowVerbs.js and the drawer below both read this.
export function thingVerbSets(characterTags = []) {
  return {
    consumable: new Set(consumableTags(characterTags).map((t) => t.id)),
    tradeable: new Set(transferableTags(characterTags).map((t) => t.id)),
    removable: new Set(destroyableTags(characterTags).map((t) => t.id)),
  };
}

// One row's verbs off those sets.
export function thingVerbs(ct, sets) {
  return {
    equippable: Boolean(ct.tag?.equippable),
    consumable: sets.consumable.has(ct.tagId),
    tradeable: sets.tradeable.has(ct.tagId),
    removable: sets.removable.has(ct.tagId),
  };
}

// `composeTag` shapes each row (tagChipRows.js). Passed IN since this module is in the client bundle.
export function thingGroups(characterTags = [], composeTag = (tag) => tag) {
  const sets = thingVerbSets(characterTags);
  // Derives its own poisonMarker off the viewer's OWN held tags, same as TagRail/TagRow.
  const canSmellPoison = canDetectPoison(characterTags);

  const rows = characterTags
    .filter((ct) => GROUPS.includes(ct.tag?.category))
    .map((ct) => ({
      // characterTagId is what an equip toggle acts on; tagId preselects dialogs.
      characterTagId: ct.id ?? null,
      tagId: ct.tagId,
      tag: composeTag(ct.tag),
      category: ct.tag.category,
      quantity: ct.quantity ?? 1,
      equipped: Boolean(ct.equipped),
      // A partly-equipped stack can offer both Equip (reserve left) and Unequip (some already out).
      equippableRemaining: (ct.quantity ?? 1) - (ct.equippedQuantity ?? 0),
      equippedQuantity: ct.equippedQuantity ?? 0,
      weightLbs: rowWeightLbs(ct),
      ...thingVerbs(ct, sets),
      poisonMarker: canSmellPoison && (ct.poisonedCount ?? 0) > 0,
    }))
    .sort((a, b) => a.tag.name.localeCompare(b.tag.name));

  return GROUPS.map((category) => ({
    category,
    rows: rows.filter((row) => row.category === category),
  })).filter((group) => group.rows.length > 0);
}
