// How the character-creation picker is grouped, and the only place that
// grouping lives. Groups by social position (court, clergy, trade, dirt),
// which cuts ACROSS zones — the Church and the Order of the Silver Cross are
// both Town clergy, the Company and the Factory are both business despite
// different zones.
//
// The slugs are also the top-level keys of docs/roles.yaml's `groups:`, but
// the NAMES live here rather than in the YAML for the reason
// PERMANENT_SEAT_ROLE_SLUGS (db/lib/roleCapacity.js) does: a typo here must
// never be able to throw db:sync-roles mid-pass with rows already written.
// The sync validates every key in the YAML against isRoleGroupSlug() up
// front, before it writes anything.
const ROLE_GROUPS = [
  { slug: "court", name: "Court" },
  { slug: "clergy", name: "Clergy" },
  { slug: "cerberon", name: "Cerberon" },
  { slug: "saviors", name: "Saviors" },
  { slug: "business", name: "Business" },
  { slug: "soil", name: "Soil" },
  { slug: "outsiders", name: "Outsiders" },
];

// Where a role nobody has bucketed ends up, so forgetting to name a group
// makes a seat look untidy rather than UNPICKABLE.
const OTHER_GROUP = { slug: "other", name: "Elsewhere" };

const ALL_GROUPS = [...ROLE_GROUPS, OTHER_GROUP];

function isRoleGroupSlug(slug) {
  return ALL_GROUPS.some((group) => group.slug === slug);
}

// Buckets a FLAT role list — each row carrying `groupSlug` — in ROLE_GROUPS
// order, dropping empty buckets. Roles keep their given order within a bucket,
// so pass them already sorted by sortOrder.
function groupRoles(roles) {
  const rows = Array.isArray(roles) ? roles : [];
  const held = new Map(ALL_GROUPS.map((g) => [g.slug, []]));
  for (const role of rows) {
    const bucket = held.has(role?.groupSlug) ? role.groupSlug : OTHER_GROUP.slug;
    held.get(bucket).push(role);
  }
  return ALL_GROUPS.map((group) => ({ slug: group.slug, name: group.name, roles: held.get(group.slug) })).filter(
    (group) => group.roles.length > 0,
  );
}

module.exports = { ROLE_GROUPS, ALL_GROUPS, isRoleGroupSlug, groupRoles };
