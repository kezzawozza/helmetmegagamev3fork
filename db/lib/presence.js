// "Here": the one co-presence rule both faces of the game judge by. A
// character can act on someone at the same Location who hasn't hidden their
// face, and — for body actions — an unburied corpse. A concealed character
// is off every picker and gate since /conceal is "you don't know who this
// is", and naming them would undo it.
//
// web/lib/peopleHere.js binds these to prisma for the web app; the bot's
// offer handlers (bot/src/lib/offers.js) and db/lib/lessons.js call them
// directly. No Prisma import here, same posture as inspectVision.js.

// Always strict about hoods, no opt-out: Transfer is the one action that
// reaches a concealed person, and it does NOT come through here — it asks
// db/lib/whosHere.js instead, which splits on what is actually over the
// face rather than this column. isHere() below still takes
// `allowConcealed`, the re-check Transfer keeps (web/lib/transferReach.js).
function hereWhere(character, { includeDead = false } = {}) {
  return {
    locationId: character.locationId,
    id: { not: character.id },
    OR: [
      { status: "ALIVE", concealed: false },
      ...(includeDead ? [{ status: "DEAD", buriedAt: null }] : []),
    ],
  };
}

// Reaching yourself is free. An unplaced actor reaches no one.
function isHere(actor, target, { allowDead = false, allowConcealed = false } = {}) {
  if (!actor?.locationId || !target) return false;
  if (target.id === actor.id) return true;
  if (target.locationId !== actor.locationId) return false;
  if (target.status === "ALIVE") return allowConcealed || !target.concealed;
  if (allowDead && target.status === "DEAD") return !target.buriedAt;
  return false;
}

const HERE_FIELDS = { id: true, locationId: true, status: true, concealed: true, buriedAt: true };

function notHereMessage(target) {
  return target?.name ? `${target.name} isn't here.` : "They aren't here.";
}

module.exports = { hereWhere, isHere, HERE_FIELDS, notHereMessage };
