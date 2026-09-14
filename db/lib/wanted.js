// The Wanted tag as a thing the law hands out, rather than as a thing you buy
// at character creation. db/lib/wantedPoster.js is the PAPER — the three
// sheets that go up when somebody is born wanted — and it re-exports the two
// helpers below so its own callers did not have to move.
//
// The tag itself is `visible: named` (docs/tags.yaml), which is the whole
// point of it: the Cerberon know your FACE, so a hood or a Disguise Kit's
// false name takes it off a bystander's read. See db/lib/medicalVision.js.
//
// Takes `db` as a parameter where it queries, the db/lib/dm.js convention.

const { matchesTypedName } = require("./characterName");

const WANTED_SLUG = "wanted";

// The Cerberon's own tag — a Censor, an Incarn, a Cerberus, a Squire all hold
// it (docs/roles.yaml). It is what opens Check Wanted.
const CERBERON_SLUG = "cerberon";

// Who may declare a warrant. The BADGE, not the role slug: every other button
// on the sheet gates on a tag, and this way the authority travels with the
// thing — including when it is looted off a body, which is a story the game
// should be able to tell.
const WARRANT_BADGE_SLUGS = Object.freeze([
  "censors-key",
  "sheriffs-badge",
  "cerberus-helmet",
]);

// `heldSlugs` is any iterable of slugs.
function isWanted(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return held.has(WANTED_SLUG);
}

function isCerberon(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return held.has(CERBERON_SLUG);
}

// Who a typed name puts a warrant on. EVERY living man who answers to it, not
// one — the law does not know which Alexander Ivanov it wants, so it wants
// both. This is the whole of the rule, kept pure and DB-free so db/test/ can
// hold it down without a database.
//
// Two kinds of match are dropped from the set rather than aborting the whole
// act, which is the part that used to be wrong. Swearing a warrant on a name
// you happen to share must still catch the other man, and a namesake who is
// already wanted must not stop a clean one being caught. Only when nothing is
// left does the caller refuse, and the three counts below are what let it say
// WHY.
//
// `candidates` are rows with `name`, `firstName`, `lastName`, `id`, and a
// `tags` array holding the wanted tag if they already have it — the shape the
// caller's query already selects.
function warrantTargets(candidates, typed, { selfId = null } = {}) {
  const matched = (candidates ?? []).filter((c) => matchesTypedName(c, typed));
  const skippedSelf = selfId ? matched.filter((c) => c.id === selfId).length : 0;
  const notMe = matched.filter((c) => c.id !== selfId);
  const alreadyWanted = notMe.filter((c) => (c.tags?.length ?? 0) > 0).length;
  const targets = notMe.filter((c) => (c.tags?.length ?? 0) === 0);
  return { matched: matched.length, targets, skippedSelf, alreadyWanted };
}

// Every living wanted man, by NAME AND NOTHING ELSE. The parallel of
// listComrades() (db/lib/thanati.js) and it answers the same notice-row shape,
// so /character renders it unchanged.
//
// The role is deliberately not in here. A warrant book that printed "Censor"
// or "Fisherman" beside a name would hand every badge holder a slice of the
// roster nobody has earned — the book is a list of names the Cerberon want,
// not a directory of who those people are. The cost is that two men who share
// a name read as two identical rows, which is the honest answer: the law has
// two Alexander Ivanovs and cannot tell them apart either.
//
// It does NOT care who is currently hooded. This is the Cerberon reading
// their own warrant book, not an act of looking at somebody: a man does not
// fall off the list by pulling a hood up. That is exactly the distinction
// `visible: named` draws — the face is hidden, the record is not.
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
  listWanted,
};
