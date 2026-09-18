// Whether a character's eyes are good enough to look somebody over right now. Gates the **Look at**
// button on /character only — the 🔍 reaction in Discord stays open, since it needs the subject to
// have just spoken beside you, close enough to see regardless. No Prisma import, same posture as
// inspectVision.js — the sheet greys a button and the server action refuses, and neither should drift
// from the other.
const NEARSIGHTED_SLUG = "nearsighted";
const SPECTACLES_SLUG = "spectacles";
const SUN_SENSITIVITY_SLUG = "sun-sensitivity";
// Blind stops looking at anything, with no corrective and no schedule. Blind Drunk is the same block
// for two turns, bought a mouthful at a time (docs/systemdocs/FACTORY.md).
const BLIND_SLUG = "blind";
const BLIND_DRUNK_SLUG = "blind-drunk";

// Accepts CharacterTag[] ({ tag: { slug } }) or a bare Tag[]. Same as inspectVision.js#slugSet.
function slugSet(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

// Only EQUIPPED gear counts — spectacles in a sack correct nothing, and `spectacles` is already
// `equippable: true`, so CharacterTag.equipped is the honest test.
function equippedSet(characterTags) {
  return new Set(
    (characterTags ?? [])
      .filter((ct) => ct?.equipped === true)
      .map((ct) => ct?.tag?.slug ?? ct?.slug)
      .filter(Boolean),
  );
}

// Why this character cannot look anyone over, or null if they can. `where` carries the two facts Sun
// Sensitivity needs (whether the sun is up, whether indoors); both default permissive, so a caller
// that can't resolve the time or a Location never blinds somebody by accident.
//
// `daylight` used to be `phase === "DAWN"`, back when a turn was half a day and a DAWN turn WAS the
// daytime. Turns are 6, 8, 12 or 24 hours now and carry no time of day at all, so the question is put
// to the real clock instead (db/lib/turnClock.js#isDaylight).
function examineBlock(characterTags = [], where = {}) {
  const { daylight = false, indoors = true } = where;
  const slugs = slugSet(characterTags);

  // First — nothing below can rescue it.
  if (slugs.has(BLIND_SLUG)) {
    return "You can't see.";
  }

  if (slugs.has(BLIND_DRUNK_SLUG)) {
    return "The room will not hold still. You can barely see.";
  }

  if (slugs.has(NEARSIGHTED_SLUG) && !equippedSet(characterTags).has(SPECTACLES_SLUG)) {
    return "Everything past arm's length is a blur. Put your spectacles on.";
  }

  // Daylight outdoors only — the Caves and the night stay fine; the tag is a schedule to work around, not an off switch.
  if (slugs.has(SUN_SENSITIVITY_SLUG) && daylight && !indoors) {
    return "The daylight is too much to look into. Wait for dark, or get under a roof.";
  }

  return null;
}

module.exports = {
  examineBlock,
  BLIND_SLUG,
};
