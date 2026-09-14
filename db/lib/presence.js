// "Here": the one co-presence rule both faces of the game judge by. A
// character can act on someone at the same Location who hasn't hidden their
// face, and — for body actions — an unburied corpse. A concealed character
// is off every picker and gate since /conceal is "you don't know who this
// is", and naming them would undo it.
//
// web/lib/peopleHere.js binds these to prisma for the web app; the bot's
// offer handlers (bot/src/lib/offers.js) and db/lib/lessons.js call them
// directly. No Prisma import here, same posture as inspectVision.js.
//
// "Concealed" is what is over the face, the rule presentedIdentity() uses: the
// /conceal column, OR a worn hood that forces it (a Cerberus Helmet hides you
// whatever the column says). A forced name outranks both.
const { presentedIdentity, forcedNameFrom, concealmentFrom } = require("./presentedIdentity");

const FORCING_HOOD = {
  equipped: true,
  tag: { concealsIdentity: true, forcesConceal: true, concealSprite: { not: null } },
};

// Always strict about hoods, no opt-out: Transfer is the one action that
// reaches a concealed person, and it does NOT come through here — it asks
// db/lib/whosHere.js instead. isHere() below still takes
// `allowConcealed`, the re-check Transfer keeps (web/lib/transferReach.js).
function hereWhere(character, { includeDead = false } = {}) {
  return {
    locationId: character.locationId,
    id: { not: character.id },
    OR: [
      {
        status: "ALIVE",
        concealed: false,
        OR: [
          { NOT: { tags: { some: FORCING_HOOD } } },
          { tags: { some: { tag: { forcedName: { not: null } } } } },
        ],
      },
      ...(includeDead ? [{ status: "DEAD", buriedAt: null }] : []),
    ],
  };
}

// The column always hides, same as hereWhere. A forcing hood hides too, but only a caller that loaded `tags` (with `equipped` and the concealment fields) can see one.
function concealedNow(target) {
  if (target.concealed) return true;
  if (!Array.isArray(target.tags)) return false;
  return presentedIdentity(target, {
    forcedName: forcedNameFrom(target.tags),
    concealment: concealmentFrom(target.tags),
  }).concealed;
}

// Reaching yourself is free. An unplaced actor reaches no one.
function isHere(actor, target, { allowDead = false, allowConcealed = false } = {}) {
  if (!actor?.locationId || !target) return false;
  if (target.id === actor.id) return true;
  if (target.locationId !== actor.locationId) return false;
  if (target.status === "ALIVE") return allowConcealed || !concealedNow(target);
  if (allowDead && target.status === "DEAD") return !target.buriedAt;
  return false;
}

const HERE_FIELDS = { id: true, locationId: true, status: true, concealed: true, buriedAt: true };

function notHereMessage(target) {
  return target?.name ? `${target.name} isn't here.` : "They aren't here.";
}

module.exports = { hereWhere, isHere, HERE_FIELDS, notHereMessage };
