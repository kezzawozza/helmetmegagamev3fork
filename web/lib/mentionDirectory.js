import { prisma } from "@lifeweb/db";
import { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom, presentedIdentity } from "@lifeweb/db/lib/presentedIdentity";

// Two lists off one query: who a `{char:<id>}` token may RESOLVE to (everybody, kept LIVE), and who the @ menu
// may OFFER (narrower, hides a hooded/disguised character). A token carries the name it was sent under
// (db/lib/say.js#stampMentionNames); messageTokens.js draws a face only while this list still calls that
// person by that same name AND says they are not hidden (PROXYING.md §5a). `includeUnburiedDead` is /notes'
// roster (CHARACTERS.md §5).
export async function loadMentionDirectory({ includeUnburiedDead = false } = {}) {
  return loadMentions({ includeUnburiedDead });
}

// presentedIdentity() decides the hide, so the forced/concealed precedence order has one copy.
export async function loadOfferableMentions({ includeUnburiedDead = false } = {}) {
  const all = await loadMentions({ includeUnburiedDead });
  return all.filter((c) => !c.hidden);
}

// The shared read. `name` is the REAL name on purpose — the frozen-name gate in messageTokens.js compares
// against it, and a token with no frozen half falls back to it. The FACE is the presented one, because
// /api/avatar is identity-blind and a chip must never be the one surface that forgets a hood.
async function loadMentions({ includeUnburiedDead }) {
  const characters = await prisma.character.findMany({
    where: livingWhere(includeUnburiedDead),
    orderBy: NAME_ORDER,
    select: {
      id: true,
      name: true,
      updatedAt: true,
      concealed: true,
      // Only the tags the two resolvers read: a name-forcing one, and anything equipped that conceals.
      tags: {
        where: {
          OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
        },
        select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
      },
    },
  });

  return characters.map((character) => {
    const shown = presentedIdentity(character, {
      forcedName: forcedNameFrom(character.tags),
      concealment: concealmentFrom(character.tags),
    });
    return shape(character, shown);
  });
}

const NAME_ORDER = [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }];

function livingWhere(includeUnburiedDead) {
  return includeUnburiedDead
    ? { OR: [{ status: "ALIVE" }, { status: "DEAD", buriedAt: null }] }
    : { status: "ALIVE" };
}

function shape(character, shown) {
  return {
    id: character.id,
    name: character.name,
    updatedAt: character.updatedAt.getTime(),
    // The helm sprite for a hood, the letter plaque for a forced name, /api/avatar for a plain face.
    avatarPath: shown.avatarPath ?? null,
    hidden: Boolean(shown.concealed || shown.forced),
  };
}
