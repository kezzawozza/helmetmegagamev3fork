// Which tags a player may pick in each tag-request menu. Each menu is one
// catalog flag (docs/systemdocs/TAGS.md §5), re-checked server-side.

import { holdsRequirement } from "./characterCreation";
import { isTradeable } from "@lifeweb/db/lib/tradeable";
import { isResourcesRow } from "@lifeweb/db/lib/resourceStack";

// Lifted into db/lib so Search can ask the same question from the other side of
// the monorepo (SEARCH.md), and re-exported here so TAGS.md §5's "single reader"
// stays true and every existing import keeps working. Imported as well as
// re-exported, because `export … from` makes no local binding and this file is
// one of the readers.
export { isTradeable };

// THE DEAD SIMPLE POOL IS GONE, and do not put it back.
//
// It was a shared ration of 4 units a turn over every 0-turn crafting and
// smithing recipe, and being 0-turn meant those units cost no Move at all — so
// four saleable things a turn rode on top of an untouched labour day, free,
// for anybody with `crafting`. Once the Depot's counter opened to everybody
// that stopped being a convenience and became an income on every sheet.
//
// The rung costs a QUARTER of a Move now (docs/tags.yaml), so four is a full
// day's work rather than a free bonus on top of one — the same four units the
// ration used to hand out, now paid for. A quarter and not a tenth because the
// Move budget is exact rational arithmetic in quarters (db/lib/tagShapes.js
// refuses anything finer, and a cost the budget cannot hold exactly is work
// somebody did not pay for).
//
// Its price did NOT come down with it. The markup was cut to +1 ¢ in the same
// pass and put back: the free ration was the problem, and the turn cost fixes it
// on its own (SMITHING.md §2, DEPOT.md §4).
//
// A recipe's OWN `perTurn` ration still exists and still works; it just has no
// shared pool behind it any more.

export function craftableTags(tags, heldTagIds = [], knownRecipeIds = null) {
  const held = new Set(heldTagIds);
  const known = knownRecipeIds ? new Set(knownRecipeIds) : null;
  return tags.filter(
    (tag) => tag.craftable && (!known || known.has(tag.id)) && (tag.stackable || !held.has(tag.id)),
  );
}

// Which recipe ids may be offered: every requirementSkills skill satisfied, and — for a non-public recipe — every ingredient already held.
export function computeKnownRecipeIds(
  tagCatalog,
  satisfied,
  characterTags,
  { visibilityBySlug = new Map(), nonAllGroupSlugs = new Set() } = {},
) {
  function isNonPublicRecipe(tag) {
    if (tag.recipePublic) return false;
    if (tag.catalogVisibility !== "ALL") return true;
    return (tag.requirementItems ?? []).some((item) => {
      if (item.kind === "group") return nonAllGroupSlugs.has(item.slug);
      const slugs = item.kind === "anyOf" ? item.slugs : [item.slug];
      return slugs.some((s) => visibilityBySlug.get(s) !== "ALL");
    });
  }
  // Mirrors resolveRecipeItems' HOLD semantics (requestActions.js) at qty 1.
  function satisfiesIngredientsAtQuantityOne(tag) {
    return (tag.requirementItems ?? []).every((item) => {
      if (item.kind === "group") {
        return characterTags.some((ct) => ct.tag.group?.slug === item.slug);
      }
      const slugs = item.kind === "anyOf" ? item.slugs : [item.slug];
      return characterTags.some((ct) => slugs.includes(ct.tag.slug));
    });
  }
  // A non-public skill (catalog:gm) is itself the anti-spam gate; holding it
  // should reveal the whole ladder, greyed for missing ingredients, rather
  // than hiding rungs behind the pantry check.
  function skillsAreAllNonPublic(tag) {
    const skills = tag.requirementSkills ?? [];
    if (skills.length === 0) return false;
    return skills.every((s) => s.catalogVisibility && s.catalogVisibility !== "ALL");
  }
  return tagCatalog
    .filter(
      (t) =>
        t.craftable &&
        (t.requirementSkills ?? []).every((skill) => satisfied.has(skill.id)) &&
        (!isNonPublicRecipe(t) || skillsAreAllNonPublic(t) || satisfiesIngredientsAtQuantityOne(t)),
    )
    .map((t) => t.id);
}

// Menu hygiene mirroring db/lib/structures.js; openBuildSiteImpl refuses server-side too.
export function placementOfferedHere(tag, { buildable = false, sites = [], locationSlug = null } = {}) {
  if (!tag?.placement) return true;
  const gate = tag.placement.locations;
  const named = Array.isArray(gate) && gate.length > 0;
  if (named && locationSlug && !gate.includes(locationSlug)) return false;
  const namedHere = named && Boolean(locationSlug) && gate.includes(locationSlug);
  if (!buildable && !namedHere) return false;
  const PRESENT = ["UNDER_CONSTRUCTION", "COMPLETE", "DAMAGED"];
  const sameType = sites.filter((s) => s.typeSlug === tag.slug && PRESENT.includes(s.status));
  if (sameType.some((s) => s.status === "UNDER_CONSTRUCTION")) return false;
  return tag.placement.unique === false || sameType.length === 0;
}

export function addRequirementSatisfied(tag, tagsById, heldTagIds) {
  if (!holdsRequirement(tag.group?.requiredTagId, tagsById, heldTagIds)) return false;
  return Boolean(tag.craftable);
}

export function destroyableTags(characterTags = []) {
  return characterTags
    .filter((ct) => ct.tag?.removable)
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1 }));
}

// Smithing/building need Workshop Equipment in reach (SMITHING.md); it is itself exempt.
const WORKSHOP_SKILL_PREFIXES = ["smithing", "builder"];

export function needsWorkshop(tag) {
  if (tag?.slug === "workshop-equipment") return false;
  const skills = tag?.requirementSkills ?? [];
  if (skills.some((skill) => skill.slug === "crafting")) return false;
  return skills.some((skill) =>
    WORKSHOP_SKILL_PREFIXES.some((prefix) => skill.slug === prefix || skill.slug?.startsWith(`${prefix}-`)),
  );
}

// A turn's craft Routine commits to one family (CRAFTING.md §2a).
const CRAFT_FAMILIES = ["brewing", "cooking", "smithing", "builder", "crafting"];

export function craftFamily(tag) {
  const prefixes = (tag?.requirementSkills ?? []).map(
    (skill) => (skill?.slug ?? "").split("-")[0],
  );
  const set = new Set(prefixes);
  for (const family of CRAFT_FAMILIES) {
    if (set.has(family)) return family;
  }
  return [...set].filter(Boolean).sort()[0] ?? "craft";
}

// Empty since the obol stopped being craftable at all (docs/tags.yaml). The
// list is kept rather than the branch deleted: "this recipe is rationed and the
// ration is a WALL, not a spill" is a shape the catalog will want again, and
// rediscovering it costs more than one empty Set.
const NEVER_SPILLS_MOVE_SLUGS = new Set();

export function moveFamilyOf(tag) {
  if (NEVER_SPILLS_MOVE_SLUGS.has(tag?.slug)) return null;
  return craftFamily(tag);
}

// Pickpocket is the deliberate exception and is NOT filtered here: it has no
// ⬢ field, and lifting a sack of raw material out of somebody's pack against
// the weight budget is exactly the thing ⬢ becoming an object was for.
export function transferableTags(characterTags = []) {
  return characterTags
    .filter((ct) => isTradeable(ct.tag) && !isResourcesRow(ct))
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1, poisonMarker: Boolean(ct.poisonMarker) }));
}

// Crates/mounts excluded: nesting a crate would compound the halving exploit; packageItemsRequest refuses it too.
export function isCrate(tag) {
  return Boolean(tag?.custom && (tag?.crateContents || tag?.crate));
}

// MOUNT-slot tags carry no weight. Depot is the deliberate exception (FACTORY.md §5, DEPOT.md §0e).
export function isMount(tag) {
  return tag?.equipSlot === "MOUNT";
}

export function packableTags(characterTags = []) {
  return characterTags
    .filter((ct) => isTradeable(ct.tag) && !isCrate(ct.tag) && !isMount(ct.tag) && !isResourcesRow(ct))
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1 }));
}

// Never listed here: drinking it opens its own naming dialog instead.
const MULLIGAN_SLUG = "mulligan-potion";

export function consumableTags(characterTags = []) {
  return characterTags
    .filter((ct) => ct.tag?.consumable && ct.tag.slug !== MULLIGAN_SLUG)
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1, poisonMarker: Boolean(ct.poisonMarker) }));
}

// See DEPOT.md §3.
export { FAST_TRAVEL_SLUGS, fastTravelCapacity } from "@lifeweb/db/lib/mounts";
