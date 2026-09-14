// How the character-creation picker is grouped, and the only place that
// grouping lives. See docs/systemdocs/CHARACTERS.md. Groups by social
// position (court, clergy, trade, dirt), which cuts ACROSS zones — the
// Church and the Order of the Silver Cross are both Town clergy, the Company
// and the Factory are both business despite different zones. Lives here
// rather than in docs/roles.yaml for the reason PERMANENT_SEAT_ROLE_SLUGS
// (db/lib/roleCapacity.js) does: a typo here must never be able to throw
// db:sync-roles mid-pass with the factions already written. Faction.zoneId
// is untouched — only the picker's headings changed.
const ROLE_GROUPS = [
  { slug: "court", name: "Court", factionSlugs: ["the-court"] },
  { slug: "clergy", name: "Clergy", factionSlugs: ["the-church", "order-of-the-silver-cross"] },
  { slug: "cerberon", name: "Cerberon", factionSlugs: ["cerberon"] },
  { slug: "saviors", name: "Saviors", factionSlugs: ["the-sanctuary"] },
  { slug: "business", name: "Business", factionSlugs: ["the-company", "the-factory"] },
  { slug: "soil", name: "Soil", factionSlugs: ["the-town", "the-inn"] },
  { slug: "outsiders", name: "Outsiders", factionSlugs: ["brigands", "unaffiliated"] },
];

// A role that reads as a different social position than its faction — the
// Fisherman is on the Factory's books but is a man alone with a rod, not a
// business. Bucketing at role grain lets one seat move without dragging its
// faction along.
const ROLE_GROUP_OVERRIDES = { fisherman: "soil" };

// Where a faction nobody has bucketed ends up, so forgetting to update this
// file makes roles look untidy rather than UNPICKABLE.
const OTHER_GROUP = { slug: "other", name: "Elsewhere", factionSlugs: [] };

// Buckets every role in ROLE_GROUPS order, dropping empty buckets. `factions`
// carries `slug` and a `roles` array; each returned role gets `faction`
// attached. Roles keep their given order within a bucket.
function groupRoles(factions) {
  const rows = Array.isArray(factions) ? factions : [];
  const bucketOf = new Map();
  for (const group of ROLE_GROUPS) {
    for (const slug of group.factionSlugs) bucketOf.set(slug, group.slug);
  }

  const held = new Map([...ROLE_GROUPS, OTHER_GROUP].map((g) => [g.slug, []]));
  for (const faction of rows) {
    const home = bucketOf.get(faction.slug) ?? OTHER_GROUP.slug;
    for (const role of faction.roles ?? []) {
      const bucket = ROLE_GROUP_OVERRIDES[role.slug] ?? home;
      held.get(held.has(bucket) ? bucket : OTHER_GROUP.slug).push({ ...role, faction });
    }
  }

  return [...ROLE_GROUPS, OTHER_GROUP]
    .map((group) => ({ slug: group.slug, name: group.name, roles: held.get(group.slug) }))
    .filter((group) => group.roles.length > 0);
}

module.exports = { ROLE_GROUPS, ROLE_GROUP_OVERRIDES, groupRoles };
