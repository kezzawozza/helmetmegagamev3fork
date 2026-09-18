// The four Court seats (Baron, Baroness, Heir, Successor) are one family: the Baron chooses the
// dynasty name, the other three inherit it, copied from whoever holds `baron`. Expressed by role slug,
// same as REOPENING_SEAT_ROLE_SLUGS in db/lib/roleCapacity.js. Pure; the prisma/Discord half lives in web/lib/dynasty.js.

// All four seats are `multiple: false` in docs/roles.yaml, so a findFirst on this slug is exact.
const DYNASTY_HEAD_SLUG = "baron";

const DYNASTY_MEMBER_SLUGS = Object.freeze(["baroness", "heir", "successor"]);

// Whose last name propagates.
function isDynastyHead(slug) {
  return slug === DYNASTY_HEAD_SLUG;
}

// Whose last name is locked — no writer of Character.name ever reads the posted lastName for these.
function isDynastyMember(slug) {
  return DYNASTY_MEMBER_SLUGS.includes(slug);
}

module.exports = {
  DYNASTY_HEAD_SLUG,
  DYNASTY_MEMBER_SLUGS,
  isDynastyHead,
  isDynastyMember,
};
