// Who is IN a place — a Conversation's members, a private Room's guests — as
// the viewer is entitled to see them. db/lib/whosHere.js answers the same
// question for a Location; these two lists never did: they shipped
// Character.id beside the name, so the strip named a hooded member outright
// — /api/avatar/<id> is ungated, so handing the browser the id IS the leak.
// A second function rather than a third argument to whosHere, since
// membership is not presence: a member may be standing anywhere. Flat list,
// not whosHere's named/concealed pair — a hood is still a seat. A concealed
// row carries `characterId: null` and a `token` instead (hoodToken, an HMAC
// under AUTH_SECRET). SIGHTINGS ARE AN ARGUMENT, not a query made here —
// whosHere.js reaches conversations.js, which is this module's own caller.
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("./presentedIdentity");
const { aliasRow } = require("./concealedIdentity");
const { hoodToken } = require("./hoodToken");

// Columns and tags presentedIdentity reads — whosHere's PRESENT_SELECT minus
// the faction half, since a members strip prints no Role.
const MEMBER_SELECT = {
  id: true,
  name: true,
  concealed: true,
  age: true,
  gender: true,
  updatedAt: true,
  tags: {
    where: {
      OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
    },
    select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
  },
};

// `characterIds` in join order, preserved rather than re-sorted. `sightings`
// is the Map db/lib/sightings.js#lastSightings returns, supplied by the
// caller to avoid a second identical query; omit it and every hood reads as
// unseen. The sighting rule is whosHere's, unchanged: it gates the FACE — a
// mask is drawn only for somebody who watched them speak in it this turn
// (PROXYING.md §5a). `gm` is the host's view: every row comes back under its
// real name with `presentedAs` saying what the room actually sees, same
// answer as db/lib/whosHere.js#whosHereGm.
async function presentedMembers(prisma, characterIds, viewer, { sightings = null, gm = false } = {}) {
  const ids = [...new Set((characterIds ?? []).filter(Boolean))];
  if (ids.length === 0) return [];

  const people = await prisma.character.findMany({
    where: { id: { in: ids }, status: "ALIVE" },
    select: MEMBER_SELECT,
  });
  const byId = new Map(people.map((person) => [person.id, person]));

  const seenBy = sightings ?? new Map();

  // Dead members drop out — a conversation is a corner of a room, not a roster.
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((person) => {
      const piece = concealmentFrom(person.tags);
      const forced = forcedNameFrom(person.tags);
      const self = person.id === viewer?.id;
      const sighting = self ? null : (seenBy.get(person.id) ?? null);
      const seen = self || Boolean(sighting);
      // Forced name is not hiding (PROXYING.md §5): named openly, only the portrait swaps for the letter plaque.
      const hidden = forced ? false : Boolean(piece && (piece.forced || person.concealed));

      if (gm) {
        return {
          characterId: person.id,
          token: null,
          name: person.name,
          avatarPath: null,
          avatarVersion: person.updatedAt?.getTime?.() ?? null,
          unknownFace: false,
          concealed: false,
          // What the room sees.
          presentedAs: forced ?? (hidden ? aliasRow(person, null) : null),
        };
      }

      if (!hidden) {
        const shown = presentedIdentity(person, { forcedName: forced });
        return {
          characterId: person.id,
          token: null,
          name: forced ?? person.name,
          // null means "own face, ask /api/avatar".
          avatarPath: forced ? shown.avatarPath : null,
          avatarVersion: person.updatedAt?.getTime?.() ?? null,
          unknownFace: false,
          concealed: false,
        };
      }

      // The id never leaves the server for a hood: `/api/avatar/<id>` takes an id and returns a face.
      const face = self
        ? presentedIdentity(person, { concealment: piece }).avatarPath
        : (sighting?.avatarPath ?? null);
      return {
        characterId: null,
        token: hoodToken(person.id),
        name: aliasRow(person, sighting?.name),
        avatarPath: seen ? face : null,
        avatarVersion: null,
        unknownFace: !seen || Boolean(sighting?.unknownFace),
        concealed: true,
      };
    });
}

// One name, for a sentence (`/add`/`/remove`'s "X was added"). Falls back to
// a bare description rather than throwing: a refusal nobody can read is worse than a vague one.
async function presentedNameOf(prisma, characterId, viewer, options) {
  const [row] = await presentedMembers(prisma, [characterId], viewer, options);
  return row?.name ?? "somebody";
}

// The other half of the hood handle: which of THESE characters a token names.
// Resolves only inside the list it was minted from, so a token can name
// somebody in a room you're in and nobody anywhere else. Same shape as
// whosHere.js#resolveHoodToken, scoped to a place's roster.
function resolveMemberToken(characterIds, token) {
  if (!token || !Array.isArray(characterIds)) return null;
  for (const id of characterIds) {
    // hoodToken answers null with no AUTH_SECRET; `null===null` would else match the first id, defeating the whole mechanism.
    const minted = hoodToken(id);
    if (minted && minted === token) return id;
  }
  return null;
}

module.exports = {
  presentedMembers,
  presentedNameOf,
  resolveMemberToken,
};
