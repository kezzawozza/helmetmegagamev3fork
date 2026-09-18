// The Wanted tag as a thing the law hands out, rather than bought at character creation. Tag is `visible: named` (docs/tags.yaml) — a hood or Disguise Kit takes it off a bystander's read.

const { matchesTypedName } = require("./characterName");

const WANTED_SLUG = "wanted";

const CERBERON_SLUG = "cerberon";

// Who may declare a warrant. The BADGE, not the role slug, so authority travels with the thing — including when looted off a body.
const WARRANT_BADGE_SLUGS = Object.freeze([
  "censors-key",
  "sheriffs-badge",
  "cerberus-helmet",
]);

function isWanted(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return held.has(WANTED_SLUG);
}

function isCerberon(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return held.has(CERBERON_SLUG);
}

// The half both verbs share: who answers to the typed name, minus the officer holding the pen. Kept in one place so the two can never disagree about what "matched" means.
function nameMatches(candidates, typed, selfId) {
  const matched = (candidates ?? []).filter((c) => matchesTypedName(c, typed));
  const skippedSelf = selfId ? matched.filter((c) => c.id === selfId).length : 0;
  const notMe = matched.filter((c) => c.id !== selfId);
  return { matched: matched.length, skippedSelf, notMe };
}

const wanted = (c) => (c.tags?.length ?? 0) > 0;

// Who a typed name puts a warrant on: EVERY living man who answers to it. Pure and DB-free so db/test/ can hold it down without a database.
function warrantTargets(candidates, typed, { selfId = null } = {}) {
  const { matched, skippedSelf, notMe } = nameMatches(candidates, typed, selfId);
  const alreadyWanted = notMe.filter(wanted).length;
  const targets = notMe.filter((c) => !wanted(c));
  return { matched, targets, skippedSelf, alreadyWanted };
}

// The mirror: who a typed name lifts a warrant OFF. Same matching, same self rule — a badge is not a pardon for the man carrying it — with the two sides of the split swapped.
function unwarrantTargets(candidates, typed, { selfId = null } = {}) {
  const { matched, skippedSelf, notMe } = nameMatches(candidates, typed, selfId);
  const notWanted = notMe.filter((c) => !wanted(c)).length;
  const targets = notMe.filter(wanted);
  return { matched, targets, skippedSelf, notWanted };
}

// Every living wanted man, by NAME AND NOTHING ELSE — parallels listComrades() (db/lib/thanati.js). Role deliberately omitted. Does NOT care who is
// currently hooded — the Cerberon reading their own book, not an act of looking at somebody: `visible: named` means the face is hidden, the record is not.
async function listWanted(db) {
  const rows = await db.character.findMany({
    where: { status: "ALIVE", tags: { some: { quantity: { gt: 0 }, tag: { slug: WANTED_SLUG } } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows.map((c) => ({ id: c.id, name: c.name }));
}

module.exports = {
  WANTED_SLUG,
  CERBERON_SLUG,
  WARRANT_BADGE_SLUGS,
  isWanted,
  isCerberon,
  warrantTargets,
  unwarrantTargets,
  listWanted,
};
