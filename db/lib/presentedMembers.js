// Who is IN a place — a Conversation's members, a private Room's guests — as
// the viewer is entitled to see them.
//
// db/lib/whosHere.js answers the same question for a Location and has always
// answered it correctly. These two lists never did: conversationMembers() and
// roomGuests() selected Character.name and shipped it with the character's id
// beside it, so the strip above a conversation named a hooded member outright
// and drew their real portrait — /api/avatar/<id> is ungated, so handing the
// browser the id IS the leak, not merely rendering it.
//
// Membership is not presence, which is why this is a second function and not a
// third argument to whosHere: a member of a conversation may be standing
// anywhere (the row persists when they walk away), while whosHere is a query
// over one Location. What the two share is the PROJECTION, and that is what
// lives here.
//
// The shape is one flat list rather than whosHere's named/concealed pair,
// because a membership strip draws one row per member whoever they are — a
// hood in a conversation is still a seat at it. A concealed row carries
// `characterId: null` and a `token` instead, the same handle whosHere mints
// for the HERE column (hoodToken, an HMAC of the id under AUTH_SECRET).
// Leaves only, and deliberately: whosHere.js reaches sightings.js ->
// feedAccess.js -> conversations.js, and conversations.js is this module's own
// caller. So the hood handle comes from its own leaf (hoodToken.js) and the
// SIGHTINGS ARE AN ARGUMENT rather than a query made here — which is also the
// cheaper shape, since the one caller that wants them has already paid for a
// Map in the same breath.
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("./presentedIdentity");
const { aliasRow } = require("./concealedIdentity");
const { hoodToken } = require("./hoodToken");

// The columns and tags presentedIdentity reads. whosHere's PRESENT_SELECT
// minus the faction half — a members strip prints no Role, so there is nothing
// to earn. CONCEALMENT_TAG_FIELDS is the shared field list for the reason it
// exists: miss one and concealment silently stops working at this surface only.
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

// `characterIds` in the order they should be drawn — membership is ordered by
// when somebody joined, and this preserves that rather than re-sorting.
//
// `sightings` is the Map db/lib/sightings.js#lastSightings returns, and it is
// the caller's to supply: placeMembers already asks for one to build the
// candidate list beside this, and a second identical query would be two
// answers to one question. Omit it and every hood reads as unseen — which errs
// toward hiding, and is exactly what Discord wants, since its readout has no
// faces in it at all.
//
// The sighting rule is whosHere's, unchanged, and it is what gates the FACE:
// standing somewhere is public, what is over your face is not, so a mask is
// drawn only for somebody who watched them speak in it this turn
// (PROXYING.md §5a). Unseen, the row wears the question-mark plate.
//
// `gm` is the host's view: nothing is hidden and nothing has to be earned, so
// every row comes back under its real name with `presentedAs` saying what the
// people in the conversation actually see. It is the same answer
// db/lib/whosHere.js#whosHereGm gives about a room, and it is here rather than
// in the web layer for the same reason — one rule about who is who, with the
// GM's view as an option on it instead of a second opinion.
async function presentedMembers(prisma, characterIds, viewer, { sightings = null, gm = false } = {}) {
  const ids = [...new Set((characterIds ?? []).filter(Boolean))];
  if (ids.length === 0) return [];

  const people = await prisma.character.findMany({
    where: { id: { in: ids }, status: "ALIVE" },
    select: MEMBER_SELECT,
  });
  const byId = new Map(people.map((person) => [person.id, person]));

  const seenBy = sightings ?? new Map();

  // Kept in the caller's order; the map above is only the lookup. Dead members
  // drop out, the rule conversationMembers has always applied — a conversation
  // is a corner of a room, not a roster, and a body cannot be in one.
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((person) => {
      const piece = concealmentFrom(person.tags);
      const forced = forcedNameFrom(person.tags);
      const self = person.id === viewer?.id;
      const sighting = self ? null : (seenBy.get(person.id) ?? null);
      const seen = self || Boolean(sighting);
      // A forced name is not hiding (PROXYING.md §5): a Beast is named Beast,
      // openly, and only loses their own portrait for the letter plaque.
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
          // What the room sees. A forced name is not hiding (PROXYING.md §5),
          // so it reads as what they are presenting as, the same as a hood.
          presentedAs: forced ?? (hidden ? aliasRow(person, null) : null),
        };
      }

      if (!hidden) {
        const shown = presentedIdentity(person, { forcedName: forced });
        return {
          characterId: person.id,
          token: null,
          name: forced ?? person.name,
          // Null means "their own face, ask /api/avatar" — which is only ever
          // said about somebody whose face this viewer may have.
          avatarPath: forced ? shown.avatarPath : null,
          avatarVersion: person.updatedAt?.getTime?.() ?? null,
          unknownFace: false,
          concealed: false,
        };
      }

      // The id never leaves the server for a hood. `/api/avatar/<id>` takes an
      // id and returns a face, so shipping one is the whole leak.
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

// One name, for a sentence. `/add` and `/remove` answer with "X was added",
// and that sentence used to carry the real name of somebody standing there in
// a hood. Falls back to a bare description rather than throwing: a refusal
// nobody can read is worse than a vague one.
async function presentedNameOf(prisma, characterId, viewer, options) {
  const [row] = await presentedMembers(prisma, [characterId], viewer, options);
  return row?.name ?? "somebody";
}

// The other half of the hood handle: which of THESE characters a token names.
//
// Recomputed over the membership the caller has already established the viewer
// may see, which is what makes the token safe to hand out — it resolves only
// inside the list it was minted from, so it can name somebody in a room you
// are in and nobody anywhere else. Same shape as
// whosHere.js#resolveHoodToken, scoped to a place's roster rather than to a
// Location's occupants.
function resolveMemberToken(characterIds, token) {
  if (!token || !Array.isArray(characterIds)) return null;
  for (const id of characterIds) {
    // hoodToken answers null with no AUTH_SECRET, and `null === null` would
    // then match the first id in the list — which is the oracle the whole
    // mechanism exists to avoid.
    const minted = hoodToken(id);
    if (minted && minted === token) return id;
  }
  return null;
}

module.exports = { presentedMembers, presentedNameOf, resolveMemberToken, MEMBER_SELECT };
