// Every caller MUST go through this: an unresolved slug is kept as `{ slug, name: slug }` rather
// than dropped, because desireGates.js treats an empty list as NO constraint.
export function projectDesireTemplateForGates(roleBySlug, template) {
  const resolveRole = (slug) => roleBySlug.get(slug) ?? { slug, name: slug };

  return {
    ...template,
    requiresAnyRoles: (template.requiresAnyRoleSlugs ?? []).map(resolveRole),
    requiresNotRoles: (template.requiresNotRoleSlugs ?? []).map(resolveRole),
  };
}

export async function loadRoleBySlugForTemplates(prisma, templates) {
  const slugs = new Set();
  for (const t of templates) {
    for (const s of t.requiresAnyRoleSlugs ?? []) slugs.add(s);
    for (const s of t.requiresNotRoleSlugs ?? []) slugs.add(s);
  }
  const roleRows = slugs.size
    ? await prisma.role.findMany({ where: { slug: { in: [...slugs] } }, select: { slug: true, name: true } })
    : [];
  return new Map(roleRows.map((r) => [r.slug, r]));
}

// A locked reason must never name a hidden tag (db/lib/desireGates.js). Two sources: a group's key
// tag and any SECRET tag. devPanelData.js passes an empty Set instead — superadmin-only, nothing withheld.
export async function computeHiddenDesireTagIds(prisma, heldTagIds) {
  const [gates, secrets] = await Promise.all([
    prisma.tagGroup.findMany({
      where: { requiredTagId: { not: null } },
      select: { requiredTagId: true },
    }),
    prisma.tag.findMany({
      where: { catalogVisibility: "SECRET" },
      select: { id: true },
    }),
  ]);
  const ids = [...gates.map((g) => g.requiredTagId), ...secrets.map((t) => t.id)];
  return new Set(ids.filter((id) => id && !heldTagIds.has(id)));
}
