// What the room could SEE of a speaker, frozen onto the line they said. A look answers for the MOMENT
// you saw somebody, never for now (PROXYING.md §5a). ONE RULE decides every question this file
// answers: Character-side frozen (appearance, name, held/worn tags, faction, role, ⬢). Catalog-side
// live — a tag's name/armour/requirement/visibility, read off Tag at look time (db/lib/examine.js#EXAMINE_TAG_SELECT),
// so a rebalance reaches old lines. Viewer-side live — the looker's own faculties (doctor's eye,
// Seductive, an officer's seat), never frozen. Payload is deliberately compact — it rides on every
// message row: `{ v: 1, n: name, a: appearance, r: roleTitle, s: resources, f: factionId, c: concealed,
// t: [[tagId, 0|1, expiresTurn], …] }`. EVERY tag goes in, not a filtered subset — pruning hidden rows
// would let a Beast's frozen line read out under their real name.
// Prisma-free except loadPresentedState, which takes `prisma` (db/lib/dm.js convention).
const { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom } = require("./presentedIdentity");

const SNAPSHOT_VERSION = 1;

// What a WRITER must load to build one — lets db/lib/say.js drop separate calls for one call to
// loadPresentedState below. No `quantity` filter, matching EXAMINE_SUBJECT_SELECT exactly.
const PRESENTED_STATE_SELECT = {
  name: true,
  appearance: true,
  roleTitle: true,
  resources: true,
  factionId: true,
  concealed: true,
  tags: {
    select: {
      tagId: true,
      equipped: true,
      expiresTurn: true,
      tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } },
    },
  },
};

// A character row loaded with PRESENTED_STATE_SELECT -> the payload. Pure.
function presentedStateFrom(character) {
  if (!character) return null;
  return {
    v: SNAPSHOT_VERSION,
    n: character.name ?? null,
    a: character.appearance ?? null,
    r: character.roleTitle ?? null,
    s: character.resources ?? null,
    f: character.factionId ?? null,
    c: Boolean(character.concealed),
    t: (character.tags ?? [])
      .filter((ct) => ct?.tagId)
      .map((ct) => [ct.tagId, ct.equipped ? 1 : 0, ct.expiresTurn ?? null]),
  };
}

// The payload back out of the column. NEVER throws: an unknown version, a malformed blob, or null all
// return null, and the caller falls back to the live character rather than a 500.
function readPresentedState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.v !== SNAPSHOT_VERSION) return null;
  if (!Array.isArray(value.t)) return null;
  const tags = [];
  for (const entry of value.t) {
    if (!Array.isArray(entry)) continue;
    const [tagId, equipped, expiresTurn] = entry;
    if (typeof tagId !== "string" || !tagId) continue;
    tags.push({
      tagId,
      equipped: equipped === 1 || equipped === true,
      expiresTurn: Number.isInteger(expiresTurn) ? expiresTurn : null,
    });
  }
  return {
    name: typeof value.n === "string" ? value.n : null,
    appearance: typeof value.a === "string" ? value.a : null,
    roleTitle: typeof value.r === "string" ? value.r : null,
    resources: Number.isFinite(value.s) ? value.s : null,
    factionId: typeof value.f === "string" ? value.f : null,
    concealed: Boolean(value.c),
    tags,
  };
}

// A subject shaped exactly like db/lib/examine.js#EXAMINE_SUBJECT_SELECT, built from the frozen state
// plus the live catalog. `live` is still needed for `id`, `updatedAt`, `age`/`gender`. `tags` is
// REPLACED outright, never merged — a merge is exactly how the robes get back in. A tag since deleted
// from the catalog simply drops out, failing toward losing a detail rather than inventing one.
function rehydrateSubject({ live, state, tags = [], faction = null }) {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  return {
    ...live,
    name: state.name ?? live?.name ?? null,
    appearance: state.appearance,
    roleTitle: state.roleTitle,
    resources: state.resources,
    factionId: state.factionId,
    faction,
    concealed: state.concealed,
    tags: state.tags
      .map((row) => {
        const tag = byId.get(row.tagId);
        if (!tag) return null;
        // Drop the id again: EXAMINE_TAG_SELECT doesn't carry one.
        const { id, ...rest } = tag;
        return { equipped: row.equipped, expiresTurn: row.expiresTurn, tag: rest };
      })
      .filter(Boolean),
  };
}

// The one query a writer needs. Returns the payload plus two identity answers derived from the SAME
// rows, so db/lib/say.js#prepareSpeech can drop its separate loadForcedName/loadConcealment calls.
async function loadPresentedState(prisma, characterId) {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: PRESENTED_STATE_SELECT,
  });
  if (!character) return { state: null, forcedName: null, concealment: undefined };
  return {
    state: presentedStateFrom(character),
    forcedName: forcedNameFrom(character.tags),
    concealment: concealmentFrom(character.tags),
  };
}

module.exports = {
  presentedStateFrom,
  readPresentedState,
  rehydrateSubject,
  loadPresentedState,
};
