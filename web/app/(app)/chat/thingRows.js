import {
  consumableTags,
  destroyableTags,
  transferableTags,
} from "@/lib/tagRequests";
import { canDetectPoison } from "@lifeweb/db/lib/poison";

// THE THINGS DRAWER's rows, built once so the first paint (play/page.js) and
// the re-read after an action (./actions.js#myThings) can never disagree about
// what is in a pocket.
//
// The four verbs are the SHEET's own predicates — `equippable`, `consumable`,
// `tradeable`, `removable` off the catalog (docs/systemdocs/TAGS.md §5),
// through the same web/lib/tagRequests.js helpers RequestActionsProvider
// builds its pools from. No new rules live here: every one of the four
// re-checks itself server-side when it is pressed.
//
// Only Items and Assets. Health, Status, Skills and the rest are not things
// you carry — the status strip above draws the ones that matter.
const GROUPS = ["Items", "Assets"];

// What one ROW puts on the weight cap, in pounds — quantity included, so the
// number is what dropping the whole row would free rather than what one of
// them weighs.
//
// This is db/lib/carry.js#rowWeight spelled a second time, for the reason
// StatusStrip.js keeps its own copy of three slugs: carry.js reaches Prisma and
// Discord through five requires, and this module is in the CLIENT bundle
// (components/TagRail.js imports thingVerbs from it). Both spell the same rule
// out of CARRY.md §1 — an untradeable row and an Asset weigh nothing, an Asset
// because it carries itself or does not move at all. Keep the two in step.
//
// Rounded per row because this one is drawn; carry.js rounds the SUM instead,
// which is why a column of these can be a tenth off the total in the chip
// above. Nothing decides anything on this number — the cap is settled
// server-side against carry.js.
const WEIGHTLESS_CATEGORY = "Assets";

function rowWeightLbs(ct) {
  const tag = ct?.tag;
  if (!tag?.tradeable) return 0;
  if (tag.category === WEIGHTLESS_CATEGORY) return 0;
  return Math.round((tag.weightLbs ?? 0) * (ct.quantity ?? 1) * 100) / 100;
}

// The four verbs for every pocket at once: { tagId -> { consumable, tradeable,
// removable } }, so a page drawing many rows asks the predicates once rather
// than once per row. The sheet's tag rail (web/app/components/RowVerbs.js) and
// the drawer below both read this, which is what keeps them agreeing.
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

// `composeTag` turns each row's catalog Tag into the shape TagChip/TagDetails
// draw (web/lib/tagChipRows.js#composeChipTag, bound to this reader). It is
// passed IN rather than imported because this module is in the client bundle —
// components/TagRail.js imports thingVerbs from it — and tagChipRows.js pulls
// prisma and auth behind it. Both callers are server-side, so both can bind it.
// The identity default keeps a caller that only wants verbs honest.
export function thingGroups(characterTags = [], composeTag = (tag) => tag) {
  const sets = thingVerbSets(characterTags);
  // Detector surface (M4 fix round): the drawer never spreads a CharacterTag
  // row raw, so this is the one place it needs to derive its own
  // poisonMarker rather than getting a stripped one handed down — computed
  // once, off the viewer's OWN held tags, same rule character/page.js's
  // sheet-row marker and the sheet's own TagRail/TagRow use.
  const canSmellPoison = canDetectPoison(characterTags);

  const rows = characterTags
    .filter((ct) => GROUPS.includes(ct.tag?.category))
    .map((ct) => ({
      // The CharacterTag row, which is what an equip toggle acts on; the
      // catalog Tag id is what every dialog preselects with.
      characterTagId: ct.id ?? null,
      tagId: ct.tagId,
      // The whole chip, so the drawer's hover is the app's own tag details —
      // the group colour, the meta rows, and a letter's text on its own sheet.
      tag: composeTag(ct.tag),
      category: ct.tag.category,
      quantity: ct.quantity ?? 1,
      equipped: Boolean(ct.equipped),
      // How many units are still free to equip — a slot holds one physical
      // item, so a partly-equipped stack can offer BOTH "Equip" (there's
      // more in reserve) and "Unequip" (some is already out) at once.
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
