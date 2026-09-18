// Breaking in an unruly arelitz (ARELITZ.md §6): the shared refusal rule the
// server action and the sheet's Break In button tooltip both read, same
// posture db/lib/soilery.js#farmRefusalFor takes for the Farm button — the
// refusal text can never drift from what actually blocks the request.
// Pure and Prisma-free, modelled on soilery.js.
const { ARELITZ_MASTERY_SLUG, BREAK_IN_TARGET } = require("./constants");

function holds(characterTags, slug) {
  return (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === slug);
}

// Null means "go ahead"; a string is the refusal to show the player.
function breakInRefusalFor(characterTags, hasOpenAction) {
  if (!holds(characterTags, ARELITZ_MASTERY_SLUG)) {
    return "You don't know how to break in an arelitz.";
  }
  if (hasOpenAction) {
    return "You already have an action this turn.";
  }
  return null;
}

// Whether a rolled Gambit succeeded — a d6, target BREAK_IN_TARGET (5+,
// roughly 1-in-3 before mood/hunger modifiers). Bascinet's chosen difficulty;
// the design doc names no threshold.
function breakInSucceeded(diceRoll, diceModifier) {
  return diceRoll + (diceModifier ?? 0) >= BREAK_IN_TARGET;
}

// The turn-close DM for a break-in attempt — read off the `brokeIn`
// MOVE_EFFECTS snapshot (db/lib/moveEffects.js), same shape harvestLine/farmDm
// read off `farmed`'s.
function breakInDm(turn, snapshot) {
  if (!snapshot) return null;
  if (snapshot.ok) {
    return `*Turn ${turn}: ${snapshot.tagName} settles under the saddle. It's broken in.*`;
  }
  if (snapshot.gone) {
    return `*Turn ${turn}: by the time you got back to it, ${snapshot.tagName} wasn't there any more.*`;
  }
  return `*Turn ${turn}: ${snapshot.tagName} throws you off. It's still unruly.*`;
}

module.exports = {
  breakInRefusalFor,
  breakInSucceeded,
  breakInDm,
};
