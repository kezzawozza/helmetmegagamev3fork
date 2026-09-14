// Shared template -> db/lib/desireGates.js projection. requiresAnyRoleSlugs/requiresNotRoleSlugs are
// slug arrays (an FK would block db:sync-roles pruning); the evaluator wants `{ slug, name }`
// objects. Every caller MUST go through this: an unresolved slug is kept as `{ slug, name: slug }`
// rather than dropped, because desireGates.js treats an empty list as NO constraint — dropping a
// slug would silently open a role-gated Desire. Pure, no prisma handle: caller hoists one query.
export function projectDesireTemplateForGates(roleBySlug, template) {
  const resolveRole = (slug) => roleBySlug.get(slug) ?? { slug, name: slug };

  return {
    ...template,
    requiresAnyRoles: (template.requiresAnyRoleSlugs ?? []).map(resolveRole),
    requiresNotRoles: (template.requiresNotRoleSlugs ?? []).map(resolveRole),
  };
}

// Builds the roleBySlug Map for projectDesireTemplateForGates above. Pass every template that will
// be projected in this request so the single query covers all of them.
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

// Tag ids a desire may be gated on WITHOUT the gate being named back to the player
// (db/lib/desireGates.js: a locked reason must never name a hidden tag). Two sources: a group's key
// tag (TagGroup.requiredTagId) and any SECRET tag — the latter catches a tag like the Thanati Belief
// that sits in a public-looking group with no requiredTag of its own. Shared by every caller
// evaluating the catalog for a character; devPanelData.js deliberately passes an empty Set instead,
// since that page is superadmin-only and nothing should be withheld from a GM's own view.
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
