// Player-facing filter for the Tag Catalog tab on /documents. Visibility is `catalog:`: SECRET
// (nobody, GMs included), GM (a player who RELATES to it), ALL (fully public).
import { holdsRequirement } from "./characterCreation";

const DEPOT_KEY_SLUG = "merchants-license";

export function catalogTags(tags, { isGm, heldTagIds = [], startingTagSlugs = [] }) {
  if (isGm) return tags.filter((tag) => tag.catalogVisibility !== "SECRET");

  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const held = new Set(heldTagIds);
  const starting = new Set(startingTagSlugs);
  const depotKey = tags.find((t) => t.slug === DEPOT_KEY_SLUG);
  const hasDepotAccess = Boolean(depotKey && held.has(depotKey.id));

  const relates = (tag) =>
    held.has(tag.id) ||
    starting.has(tag.slug) ||
    // The tag's own requiredTag is deliberately NOT a gate here (TAGS.md §3a).
    (tag.group?.requiredTagId != null &&
      holdsRequirement(tag.group.requiredTagId, tagsById, heldTagIds)) ||
    (hasDepotAccess && tag.depotPrice != null);

  return tags.filter((tag) => {
    if (tag.catalogVisibility === "ALL") return true;
    if (tag.catalogVisibility === "GM") return relates(tag);
    return false;
  });
}
