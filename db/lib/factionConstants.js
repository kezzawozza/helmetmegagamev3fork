// The one faction the game treats as "no faction at all". Match on the slug, not `faction.name`
// ("Unaffiliated") — the name is player/GM-editable, the slug isn't. Same posture as db/lib/roleIds.js.

const UNAFFILIATED_SLUG = "unaffiliated";

// True for the standing "nobody" faction, and for having no faction at all — the same thing everywhere.
function isUnaffiliated(faction) {
  if (!faction) return true;
  return faction.slug === UNAFFILIATED_SLUG;
}

// The inverse, for "are these two people in a real faction together?" — db/lib/examine.js, FACTIONS.md §4a.
function inRealFaction(subject) {
  return Boolean(subject?.factionId) && !isUnaffiliated(subject.faction);
}

module.exports = { UNAFFILIATED_SLUG, isUnaffiliated, inRealFaction };
