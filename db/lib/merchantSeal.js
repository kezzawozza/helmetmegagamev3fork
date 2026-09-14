// The Merchant's wax stamp bears his own initials. Unlike every other stamp,
// his mark can't be cut into docs/tags.yaml: the initials are whoever took
// the seat this game. Written once, at character creation
// (web/app/(app)/character/createActions.js); db/lib/syncTags.js leaves this
// field and the composed description alone so db:sync-tags can't rub it back
// off. Set once and never re-synced — a Merchant who dies and is replaced
// leaves his stamp behind with his initials still on it, correctly: it's a
// physical object.
//
// Takes `prisma` (or a tx) as a parameter, off the @lifeweb/db barrel
// (db/lib/dm.js convention).

const MERCHANT_STAMP_SLUG = "merchants-wax-stamp";

// "Aurel Vane" -> "A.V." · "Gribb" -> "G." Splits on whitespace rather than
// firstName/lastName, so a three-part name still produces something.
function initialsOf(name) {
  const parts = String(name ?? "")
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((part) => `${part[0].toUpperCase()}.`).join("");
}

// Single-name Merchants get "initial" rather than "initials".
function merchantSealMark(name) {
  const initials = initialsOf(name);
  if (!initials) return null;
  const word = initials.split(".").filter(Boolean).length > 1 ? "initials" : "initial";
  return `Bears his ${word}, ${initials} — oddly modern and minimalist.`;
}

// Best-effort by contract: the caller wraps this in .catch().
async function setMerchantSeal(tx, name) {
  const mark = merchantSealMark(name);
  if (!mark) return null;
  return tx.tag.update({
    where: { slug: MERCHANT_STAMP_SLUG },
    data: {
      sealMark: mark,
      description: `The Merchant's wax stamp. ${mark}`,
    },
  });
}

module.exports = {
  setMerchantSeal,
};
