import { prisma } from "@lifeweb/db";
import { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom, presentedIdentity } from "@lifeweb/db/lib/presentedIdentity";

// Two lists: who a `{char:<id>}` token may RESOLVE to (everybody, kept LIVE), and who the @ menu may
// OFFER (narrower, hides a hooded/disguised character). A token carries the name it was sent under
// (db/lib/say.js#stampMentionNames); messageTokens.js draws a face only while this list still calls that
// person by that same name (PROXYING.md §5a). `includeUnburiedDead` is /notes' roster (CHARACTERS.md §5).
export async function loadMentionDirectory({ includeUnburiedDead = false } = {}) {
  const characters = await prisma.character.findMany({
    where: livingWhere(includeUnburiedDead),
    orderBy: NAME_ORDER,
    select: { id: true, name: true, updatedAt: true },
  });
  return characters.map(shape);
}

// presentedIdentity() decides the hide, so the forced/concealed precedence order has one copy.
export async function loadOfferableMentions({ includeUnburiedDead = false } = {}) {
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

  const out = [];
  for (const character of characters) {
    const shown = presentedIdentity(character, {
      forcedName: forcedNameFrom(character.tags),
      concealment: concealmentFrom(character.tags),
    });
    if (shown.concealed || shown.forced) continue;
    out.push(shape(character));
  }
  return out;
}

const NAME_ORDER = [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }];

function livingWhere(includeUnburiedDead) {
  return includeUnburiedDead
    ? { OR: [{ status: "ALIVE" }, { status: "DEAD", buriedAt: null }] }
    : { status: "ALIVE" };
}

function shape(character) {
  return {
    id: character.id,
    name: character.name,
    updatedAt: character.updatedAt.getTime(),
    avatarPath: null,
  };
}
