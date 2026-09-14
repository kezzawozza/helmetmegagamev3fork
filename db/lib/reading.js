// Whether a character can read a piece of writing right now. Letters are a
// SKILL (the `literate` tag); eyes are a CONDITION (db/lib/examineVision.js
// owns that half). Both have to be true.
//
// ONE MESSAGE FOR EVERY CAUSE: a blind man and an illiterate one see exactly
// the same line, since a tag-specific message would leak a condition to
// anyone looking over your shoulder.
//
// No Prisma import, same posture as examineVision.js/inspectVision.js: the
// sheet wants the answer to compose a chip, the server action wants it to
// refuse, and neither should drift from the other.
const { examineBlock } = require("./examineVision");

const LITERATE_SLUG = "literate";

// What every blocked reader sees, whatever blocked them.
const CANNOT_READ = "You can't read this.";

// Accepts CharacterTag[] (`{ tag: { slug } }`) or a bare Tag[]. Same as
// examineVision.js#slugSet.
function slugSet(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

// Null when they can read, CANNOT_READ when they can't. `where` defaults to
// the permissive side so a caller that can't resolve a turn/Location never
// blinds somebody by accident. examineBlock's contract, passed straight
// through.
function readBlock(characterTags = [], where = {}) {
  if (examineBlock(characterTags, where)) return CANNOT_READ;
  if (!slugSet(characterTags).has(LITERATE_SLUG)) return CANNOT_READ;
  return null;
}

// The positive form, for a caller that only wants to show or hide a button.
function canRead(characterTags = [], where = {}) {
  return readBlock(characterTags, where) === null;
}

module.exports = { readBlock, canRead, CANNOT_READ, LITERATE_SLUG };
