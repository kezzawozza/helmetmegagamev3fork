// What a tag OPENS: the Desires it makes takeable — the reverse of `requires.anyTags` in docs/desires.yaml. Pure (PointBuy is a client component). ONLY THE UNLOCK DIRECTION: the locking half is deliberately absent.

import { splitTokens } from "@/app/components/richTokens";

// Desire names carry {tag:…} inline references; ChipText's context can't be used here, so the token is flattened by title-casing the slug.
function titleCase(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function plainDesireName(name) {
  return splitTokens(String(name ?? ""))
    .map((part) => (part.kind === "tag" ? titleCase(part.payload) : (part.text ?? part.raw)))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function withTagsNote(others, visibleTagSlugs) {
  if (!others.length) return null;
  const known = visibleTagSlugs
    ? others.filter((t) => visibleTagSlugs.has(t.slug))
    : others;
  if (known.length !== others.length) {
    return known.length ? `with ${known.map((t) => t.name).join(" + ")} and another tag` : "with another tag";
  }
  return `with ${known.map((t) => t.name).join(" + ")}`;
}

// requiresAnyOf = false: tag AND role, marked "+ role". requiresAnyOf = true (`combine: or`): tag OR role, unmarked.
function rolesNote(template) {
  const needsRole = (template.requiresAnyRoleSlugs?.length ?? 0) > 0 && !template.requiresAnyOf;
  return needsRole ? "+ role" : null;
}

// `visibleTagSlugs` keeps a co-requirement note from naming an unseen tag. Returns [{ slug, name, tier, note }], best-paying first.
export function desireUnlocksFor(tag, { visibleTagSlugs = null } = {}) {
  const rows = new Map();

  for (const template of tag?.desireRequiredBy ?? []) {
    rows.set(template.slug, {
      slug: template.slug,
      name: plainDesireName(template.name),
      tier: template.tier,
      note: rolesNote(template),
    });
  }

  // An `allTags` Desire wants every tag in its list; overwrites above since the harder requirement wins.
  for (const template of tag?.desireAllRequiredBy ?? []) {
    const others = (template.requiresAllTags ?? []).filter((t) => t.slug !== tag.slug);
    rows.set(template.slug, {
      slug: template.slug,
      name: plainDesireName(template.name),
      tier: template.tier,
      note: withTagsNote(others, visibleTagSlugs),
    });
  }

  // Tier descending (the biggest prize reads first); name breaks ties so order never wobbles.
  return [...rows.values()].sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
}
