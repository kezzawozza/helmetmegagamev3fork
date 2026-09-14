// Which uploaded avatars a GM still has to look at. Uploads are capped at
// 5MB and re-encoded through sharp to a 256×256 WebP, which guarantees valid
// image bytes and strips metadata but says nothing about what the picture IS
// — this is the review half behind that (PORTRAITS.md §1a). ONLY UPLOADS: the
// portrait maker posts part/palette indices re-rendered server-side from
// committed sprite sheets, so a forged request there can at worst pick a
// different nose (PORTRAITS.md §4) — putting maker faces in the queue would
// bury real uploads. `Character.portrait` tells the two apart with no new
// column: the maker stores its selection there, an upload leaves it null.

// Waiting = an upload set since it was last looked at. Twin of `avatarReviewWhere` below — one
// runs in Postgres, the other in a test, and they have to agree.
function avatarNeedsReview(character) {
  if (!character) return false;
  if (!character.avatarData) return false; // Bytes column: this only asks whether something is there
  if (character.portrait) return false;
  if (!character.avatarSetAt) return false;
  if (!character.avatarReviewedAt) return true;
  return new Date(character.avatarSetAt) > new Date(character.avatarReviewedAt);
}

// The same sentence as a Prisma `where`. Takes the client rather than
// importing it (db/lib/dm.js precedent: requiring db/index.js back from
// db/lib resolves to a partial exports object). `prisma.character.fields` is
// Prisma's field reference, the one way to compare two columns of the SAME row.
// THE NULL ARM IS NOT OPTIONAL: a comparison never matches NULL, so the `lt`
// arm alone would silently drop every picture nobody has looked at — a
// mistake this repo has made before.
function avatarReviewWhere(prisma) {
  return {
    avatarData: { not: null },
    portrait: null,
    avatarSetAt: { not: null },
    OR: [
      { avatarReviewedAt: null }, // never looked at
      { avatarReviewedAt: { lt: prisma.character.fields.avatarSetAt } }, // looked at, then changed again
    ],
  };
}

module.exports = { avatarNeedsReview, avatarReviewWhere };
