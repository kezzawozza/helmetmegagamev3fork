// Shared rules for character creation, used by the wizard, createCharacter
// and the GM panel, so budgets never disagree. Pure functions only.
import { roleCapacity, SPAWN_ONLY_ROLE_SLUGS, isSpawnOnly } from "@lifeweb/db/lib/roleCapacity";

// Defaults for the two drawback ceilings (GameConfig.maxDrawbackTags/
// maxDrawbackPoints, editable on /gm/dev); a build stops at whichever it reaches first — TAGS.md §4a.
export const DEFAULT_MAX_DRAWBACK_TAGS = 6;
export const DEFAULT_MAX_DRAWBACK_POINTS = 13;

// A drawback is any tag with a negative pointCost (TAGS.md §4a).
export function negativeTagCount(tags) {
  return tags.reduce((count, t) => ((t.pointCost ?? 0) < 0 ? count + 1 : count), 0);
}

// Raw pointCost, never effectiveCost — the tier-chain discount would give a
// future negative-cost chain a quiet way past the cap.
export function negativeTagPoints(tags) {
  return tags.reduce((sum, t) => ((t.pointCost ?? 0) < 0 ? sum - t.pointCost : sum), 0);
}

// Spawn-only seats are HIDDEN, unlike a whitelisted seat, which greys itself.
export { SPAWN_ONLY_ROLE_SLUGS, isSpawnOnly };

// PLACEHOLDER — Bascinet's wording pending. The one sentence a player with an
// unburied body reads, on the creation page and from both server actions. An
// unburied death now stops you making anybody at all, not just anybody good.
export const CURSED_REFUSAL =
  "Your body is still lying where it fell. Until somebody buries it or carves your name in stone, you cannot make a new character.";

// One budget for everybody who reaches the wizard. The curse used to dock six
// points here and cancel the role's bonus; it now refuses creation outright
// (createActions.js), so there is no discounted character left to price.
export function computeBudget({ startingTagPoints, role }) {
  const base = startingTagPoints ?? 0;
  const modifier = role?.extraStartingPoints ?? 0;
  return Math.max(0, base + modifier);
}

function totalCost(tags) {
  return tags.reduce((sum, tag) => sum + (tag.pointCost ?? 0), 0);
}

// A tier chain replaces its lower tier rather than stacking; requiredTag is
// non-replacing. tag -> [tag, ...ancestors] via parentTagId, closest-first.
export function chainOf(tag, tagsById) {
  const chain = [];
  let current = tag;
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.parentTagId ? tagsById.get(current.parentTagId) : null;
  }
  return chain;
}

export function tagsById(tags) {
  return new Map(tags.map((tag) => [tag.id, tag]));
}

export function cumulativeCost(tag, tagsById) {
  return totalCost(chainOf(tag, tagsById));
}

function heldChainMember(tag, tagsById, heldOrSelectedIds) {
  const held = new Set(heldOrSelectedIds);
  const chain = chainOf(tag, tagsById);
  let best = null;
  for (const member of chain) {
    if (member.id === tag.id) continue;
    if (!held.has(member.id)) continue;
    if (!best || cumulativeCost(member, tagsById) > cumulativeCost(best, tagsById)) {
      best = member;
    }
  }
  return best;
}

export function effectiveCost(tag, tagsById, heldOrSelectedIds) {
  const held = heldChainMember(tag, tagsById, heldOrSelectedIds);
  const base = cumulativeCost(tag, tagsById);
  return held ? base - cumulativeCost(held, tagsById) : base;
}

export function chainSiblingsToRemove(tag, tagsById, heldOrSelectedIds) {
  const chainIds = new Set(chainOf(tag, tagsById).map((t) => t.id));
  chainIds.delete(tag.id);
  return heldOrSelectedIds.filter((id) => chainIds.has(id));
}

// Non-empty means acquiring `tag` would be a downgrade, which every purchase path rejects.
export function heldHigherTiers(tag, tagsById, heldOrSelectedIds) {
  return heldOrSelectedIds.filter((id) => {
    if (id === tag.id) return false;
    const held = tagsById.get(id);
    if (!held) return false;
    return chainOf(held, tagsById).some((member) => member.id === tag.id);
  });
}

export function holdsRequirement(requiredTagId, tagsById, heldOrSelectedIds) {
  if (!requiredTagId) return true;
  return heldOrSelectedIds.some((id) => {
    const held = tagsById.get(id);
    if (!held) return false;
    return chainOf(held, tagsById).some((member) => member.id === requiredTagId);
  });
}

// Combines the per-tag requiredTag and the whole-group gate (TAGS.md §3).
export function requirementSatisfied(tag, tagsById, heldOrSelectedIds) {
  return (
    holdsRequirement(tag.requiredTagId, tagsById, heldOrSelectedIds) &&
    holdsRequirement(tag.group?.requiredTagId, tagsById, heldOrSelectedIds)
  );
}

// At most one `exclusive` tag per group, except a requiredTag-linked pair. Enforced server-side.
export function exclusiveConflict(tag, heldOrSelectedIds, byId) {
  if (!tag.exclusive) return null;
  for (const id of heldOrSelectedIds) {
    if (id === tag.id) continue;
    const other = byId.get(id);
    if (!other?.exclusive) continue;
    if ((other.groupId ?? null) !== (tag.groupId ?? null)) continue;
    if (tag.requiredTagId === other.id || other.requiredTagId === tag.id) continue;
    return other;
  }
  return null;
}

export function conflictingTag(tag, heldOrSelectedIds, byId) {
  const conflictIds = tag.conflictsWithIds;
  if (!conflictIds?.length) return null;
  const conflictSet = new Set(conflictIds);
  for (const id of heldOrSelectedIds) {
    if (id === tag.id) continue;
    if (conflictSet.has(id)) return byId.get(id) ?? null;
  }
  return null;
}

// A seat that can never take this tag, filtered outright (not menu-dimmed).
// A tag uses at most one spelling (syncTags.js throws on both):
// `excludedRoleSlugs` shuts seats out, `onlyRoleSlugs` is the only ones let in.
export function roleExcluded(tag, roleSlug) {
  const only = tag.onlyRoleSlugs ?? [];
  if (only.length > 0) return !roleSlug || !only.includes(roleSlug);
  if (!roleSlug) return false;
  return (tag.excludedRoleSlugs ?? []).includes(roleSlug);
}


// Menus must derive category tabs from THIS, or an all-locked category advertises its own secret.
export function unlockedTags(tags, tagsById, heldOrSelectedIds, keepIds = []) {
  const keep = new Set(keepIds);
  return tags.filter(
    (tag) => keep.has(tag.id) || requirementSatisfied(tag, tagsById, heldOrSelectedIds),
  );
}

export function effectiveTotalCost(tags, tagsById, heldIds = []) {
  return tags.reduce((sum, tag) => sum + effectiveCost(tag, tagsById, heldIds), 0);
}

// The whitelist is the only thing left that greys a role out for WHO you are.
// Whether the seat is free is asked separately, against roleCapacity.
export function isRoleSelectable({ role, leaderWhitelisted }) {
  return !(role.requiresWhitelist && !leaderWhitelisted);
}

// A mastery tag is bought with points earned in play, so the wizard never offers one.
export function purchasableTags({ tags, afterStartOnly, grantedNames = [], roleSlug = null }) {
  const granted = new Set(grantedNames);
  return tags.filter((tag) => {
    if (!tag.purchasable) return false;
    if (afterStartOnly && !tag.purchasableAfterStart) return false;
    if (!afterStartOnly && tag.mastery) return false;
    if (roleExcluded(tag, roleSlug)) return false;
    return !granted.has(tag.name);
  });
}

export function sortTagsForMenu(tags) {
  return [...tags].sort(
    (a, b) => (b.pointCost ?? 0) - (a.pointCost ?? 0) || a.name.localeCompare(b.name),
  );
}

function chainKey(tag, tagsById) {
  const chain = chainOf(tag, tagsById);
  return { root: chain[chain.length - 1].name, depth: chain.length };
}

export function sortForMode(tags, mode, tagsById) {
  if (mode === "cost") return sortTagsForMenu(tags);
  if (mode === "name") return [...tags].sort((a, b) => a.name.localeCompare(b.name));
  return [...tags].sort((a, b) => {
    const ka = chainKey(a, tagsById);
    const kb = chainKey(b, tagsById);
    return ka.root.localeCompare(kb.root) || ka.depth - kb.depth || a.name.localeCompare(b.name);
  });
}

// Callers must have fetched the requiredTag relations alongside the ids.
export function prerequisiteNames(tag) {
  const names = [tag.requiredTag?.name, tag.group?.requiredTag?.name];
  return [...new Set(names.filter(Boolean))];
}

export function hasPrerequisite(tag) {
  return Boolean(
    tag.requiredTagId || tag.group?.requiredTagId || (tag.craftable && tag.requirementSkills?.length),
  );
}

export function menuCategories(tags) {
  return [...new Set(tags.map((tag) => tag.category))].sort((a, b) => a.localeCompare(b));
}

// Sign/colour describe the player's point pool, not tag valence.
export function formatCost(pointCost) {
  const delta = -(pointCost ?? 0);
  return delta > 0 ? `+${delta}` : String(delta);
}

export function costColor(pointCost) {
  const cost = pointCost ?? 0;
  if (cost < 0) return "var(--positive)";
  if (cost > 0) return "var(--accent-text)";
  return "var(--muted)";
}

export { roleCapacity };

// Deliberately NOT a gate — callers must run this AFTER unlockedTags().
function fold(value) {
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function filterTagsByQuery(tags, query) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return tags;
  return tags.filter((tag) => {
    const haystack = `${fold(tag.name)} ${fold(tag.description)} ${fold(tag.group?.name)}`;
    return terms.every((term) => haystack.includes(term));
  });
}
