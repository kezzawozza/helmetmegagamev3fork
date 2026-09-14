import { prisma, startingTagSlugs } from "@lifeweb/db";
import { TAG_CHIP_FIELDS, APPRAISAL_SELECT, stripEmptyUnlocks, cookedTasteOnly } from "@/lib/referenceData";
import { appraise } from "@/lib/appraisal";

// A buy menu is not a recipe book: prints a recipe only where the gating trade is public knowledge.
function recipeFields(t) {
  const skills = t.requirementSkills ?? [];
  if (skills.some((s) => s.catalogVisibility !== "ALL")) {
    return {
      craftable: false,
      requirementSkills: [],
      requirementTurns: null,
      requirementPerTurn: null,
      requirementResources: null,
      requirementGambit: false,
    };
  }
  return {
    craftable: t.craftable,
    requirementSkills: skills.map(({ id, slug, name }) => ({ id, slug, name })),
    requirementTurns: t.requirementTurns,
    requirementPerTurn: t.requirementPerTurn,
    requirementResources: t.requirementResources,
    requirementGambit: t.requirementGambit,
  };
}

// Shared by the creation wizard's loader and /store so the two menus can never disagree about a
// tag's shape. The group's requiredTagId is the hidden-category gate (docs/systemdocs/TAGS.md §3).
export async function loadPointBuyCatalog(
  extraTagIds = [],
  { includeRoleStartingTags = false, canAppraise = false } = {},
) {
  const or = [{ purchasable: true }];
  if (extraTagIds.length) or.push({ id: { in: extraTagIds } });
  if (includeRoleStartingTags) {
    const roles = await prisma.role.findMany({ select: { startingTagSlugs: true } });
    const slugs = [...new Set(roles.flatMap((r) => startingTagSlugs(r.startingTagSlugs)))];
    if (slugs.length) or.push({ slug: { in: slugs } });
  }
  const tags = await prisma.tag.findMany({
    where: or.length === 1 ? or[0] : { OR: or },
    select: {
      // Spread, not retyped — a dropped field fails silently as a line rendering nothing.
      ...TAG_CHIP_FIELDS,
      ...APPRAISAL_SELECT,
      requirementSkills: { select: { id: true, slug: true, name: true, catalogVisibility: true } },
      purchasable: true,
      purchasableAfterStart: true,
      excludedRoleSlugs: true,
      onlyRoleSlugs: true,
      parentTagId: true,
      exclusive: true,
      groupId: true,
      conflictsWith: { select: { id: true } },
      equipSlot: true,
      equipLayer: true,
      twoHanded: true,
    },
  });
  // `conflictsWith` becomes the plain id array conflictingTag() scopes on; `catalogVisibility` is
  // dropped so a tag's own secrecy gate never ships to the browser.
  return tags.map(({ conflictsWith, catalogVisibility, ...t }) =>
    // cookedTasteOnly: an ingredient's mood and hidden effects must not cross, only its taste.
    appraise(
      cookedTasteOnly(
        stripEmptyUnlocks({
          ...t,
          conflictsWithIds: conflictsWith.map((c) => c.id),
          ...recipeFields(t),
        }),
      ),
      canAppraise,
    ),
  );
}
