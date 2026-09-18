// What the room could SEE of a speaker, frozen onto the line they said — a look answers for the
// MOMENT you saw somebody, never for now (PROXYING.md §5a). ONE RULE: Character-side frozen
// (appearance, name, held/worn tags, ⬢); catalog-side live (a tag's name/armour/
// requirement/visibility, read off Tag at look time — db/lib/examine.js#EXAMINE_TAG_SELECT — so a
// rebalance reaches old lines); viewer-side live (the looker's own faculties, never frozen). Payload
// is compact — rides on every message row: `{ v, n, a, s, c, t: [[tagId, 0|1, expiresTurn]] }`. A row
// written before factions were removed also carries `r` and `f`; both are ignored on the way back out.
// EVERY tag goes in, not a filtered subset — pruning hidden rows would let a Beast's frozen line read
// out under their real name. Prisma-free except loadPresentedState, which takes `prisma` (db/lib/dm.js
// convention).
const { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom } = require("./presentedIdentity");
const { RESOURCES_SLUG, resourcesOf } = require("./resourceStack");

const SNAPSHOT_VERSION = 1;

// What a writer must load to build one. No `quantity` filter, matching EXAMINE_SUBJECT_SELECT exactly.
const PRESENTED_STATE_SELECT = {
  name: true,
  appearance: true,
  concealed: true,
  tags: {
    select: {
      tagId: true,
      equipped: true,
      expiresTurn: true,
      // `quantity` and `slug` are here for the ⬢ count alone: it is a stack row
      // now rather than a column, and `s` below still has to freeze a number.
      quantity: true,
      tag: { select: { slug: true, forcedName: true, ...CONCEALMENT_TAG_FIELDS } },
    },
  },
};

// A character row loaded with PRESENTED_STATE_SELECT -> the payload.
function presentedStateFrom(character) {
  if (!character) return null;
  return {
    v: SNAPSHOT_VERSION,
    n: character.name ?? null,
    a: character.appearance ?? null,
    s: resourcesOf(character),
    c: Boolean(character.concealed),
    t: (character.tags ?? [])
      .filter((ct) => ct?.tagId)
      .map((ct) => [ct.tagId, ct.equipped ? 1 : 0, ct.expiresTurn ?? null]),
  };
}

// The payload back out of the column. NEVER throws — an unknown version, a malformed blob, or null
// all return null, and the caller falls back to the live character rather than a 500.
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
    resources: Number.isFinite(value.s) ? value.s : null,
    concealed: Boolean(value.c),
    tags,
  };
}

// A subject shaped like db/lib/examine.js#EXAMINE_SUBJECT_SELECT, built from the frozen state plus the
// live catalog. `live` still supplies `id`, `updatedAt`, `age`/`gender`. `tags` is REPLACED outright,
// never merged — a merge is how the robes get back in. A tag since deleted from the catalog just
// drops out, failing toward losing a detail rather than inventing one.
function rehydrateSubject({ live, state, tags = [] }) {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  return {
    ...live,
    name: state.name ?? live?.name ?? null,
    appearance: state.appearance,
    concealed: state.concealed,
    tags: state.tags
      .map((row) => {
        const tag = byId.get(row.tagId);
        if (!tag) return null;
        // Drop the id — EXAMINE_TAG_SELECT doesn't carry one.
        const { id, ...rest } = tag;
        // The ⬢ row gets the frozen count put back on it, since `t` carries no
        // quantities: ⬢ are a stack row rather than a column, so the number has
        // to come back the way it left. A line frozen before ⬢ became a stack
        // has no row to land on and simply reads as none.
        const quantity = rest.slug === RESOURCES_SLUG ? (state.resources ?? 0) : 1;
        return { equipped: row.equipped, expiresTurn: row.expiresTurn, quantity, tag: rest };
      })
      .filter(Boolean),
  };
}

// The one query a writer needs — the payload plus two identity answers off the SAME rows, so
// db/lib/say.js#prepareSpeech can drop its separate loadForcedName/loadConcealment calls.
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
