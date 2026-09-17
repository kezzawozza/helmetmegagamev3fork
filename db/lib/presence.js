// "Here": the one co-presence rule both faces of the game judge by.
//
// hereWhere() is the NAMED half of a roster — everybody at this Location whose
// face you can see, plus, for body actions, an unburied corpse. It is not the
// whole roster and has not been for a while: web/lib/peopleHere.js#rosterHere is
// the other half, and web/lib/peoplePools.js composes both into every picker.
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

// Always strict about hoods, no opt-out — that is what makes it the named half
// rather than a bug. The people it leaves out are not unreachable; they come
// back through db/lib/whosHere.js, which hands out a TOKEN instead of an id, and
// go to the server through db/lib/targetKey.js.
//
// That set used to be Transfer alone, then Search, then every verb acting on a
// BODY rather than on a name. It is now all of them — Heal and Loot were the
// last two held out, on the argument that a wound list or an inventory names
// somebody nearly as well as a name does, and that argument lost: a man in a
// closed helmet could not be treated, dosed, handed a cure, or gone through when
// he went down dying. A hood made you immortal by neglect. Heal narrows a hooded
// patient's wound list to what the reader could actually see instead
// (db/lib/medicalVision.js), which is what the 🔍 embed already did.
// See docs/systemdocs/PROXYING.md §5 for the whole of it.
//
// isHere() below takes `allowConcealed`, which every one of those verbs passes.
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

module.exports = { hereWhere, isHere, concealedNow, HERE_FIELDS, notHereMessage };
