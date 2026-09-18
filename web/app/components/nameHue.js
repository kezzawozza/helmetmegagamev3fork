// Which of the six name colours a character wears (REDESIGN.md §3, Text). Bold
// coloured names are how you find a person in a wall of grey narration, and the
// colour has to be the SAME one every session or it is decoration rather than
// information — so it is a pure hash of the character's id, held nowhere and
// needing no column.
//
// Six, not more: every one of them owes full AA as bold body text on the log's
// ground, and audit-contrast.js gates all six at 4.5. A seventh would be a
// seventh colour to keep above that floor in both looks.
//
// FNV-1a, 32-bit, because it is four lines and spreads short strings evenly —
// a cuid's entropy is at its tail, and a plain character sum would give every
// name in one minute of the game the same bucket.
export const NAME_HUES = 6;

export default function nameHue(key) {
  if (typeof key !== "string" || !key) return null;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    // Math.imul keeps the multiply in 32 bits; a plain `*` overflows into a
    // float and the low bits stop mattering, which is exactly the entropy used.
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % NAME_HUES) + 1;
}
