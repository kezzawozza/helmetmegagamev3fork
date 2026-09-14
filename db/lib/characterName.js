// Name = honorific + first + "title" + last (docs/systemdocs/CHARACTERS.md §1b). Pure (no prisma/I/O) so web/lib/characterName.js can import it client-side.
const { TITLE_WORDS, earnedTitles } = require("./titles");

// Discord's webhook username caps at 80; slicing there breaks db/lib/messageWipe.js's name-keyed lookup, so inputs are capped instead. All three writers of `name` enforce this — nothing downstream slices.
const NAME_LIMITS = Object.freeze({
  honorific: 10,
  firstName: 24,
  title: 20,
  lastName: 20,
});

function formatCharacterName({ honorific, firstName, title, lastName } = {}) {
  const quoted = title && title.trim() ? `"${title.trim()}"` : null;
  return [honorific, firstName, quoted, lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

// Discord-facing form; bare so a title never recolours a role or eats the 32-char nickname budget.
function formatBareName({ firstName, lastName } = {}) {
  return [firstName, lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

const FULL_NAME_LIMIT = 80;

function nameKey(value) {
  return (value ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// Full name OR bare `First Last` match, deliberately, so an honorific never blocks a match. Exact only, no fuzzy matching.
function matchesTypedName(character, typed) {
  const key = nameKey(typed);
  if (!key) return false;
  return key === nameKey(character?.name) || key === nameKey(formatBareName(character ?? {}));
}

// Splits on the FIRST space; mirrors the character_name_parts migration SQL, used by the backfill on an older-dump restore.
function splitLegacyName(name) {
  const trimmed = (name ?? "").trim();
  const at = trimmed.indexOf(" ");
  if (at === -1) return { firstName: trimmed, lastName: null };
  return {
    firstName: trimmed.slice(0, at),
    lastName: trimmed.slice(at + 1).trim() || null,
  };
}

// GM path: any word on anyone, per TAGS.md §3 (a GM grant ignores gates) — also the only way to clear an unre-selectable title.
function normalizeHonorific(value) {
  const v = (value ?? "").toString().trim();
  return TITLE_WORDS.includes(v) ? v : null;
}

// Call ONLY where choosing a title — re-normalizing elsewhere (web/lib/dynasty.js never does) would strip "Sir" from a disgraced knight. `gender` matters: "Lord" against the default NEUTRAL list rejects it.
function normalizeEarnedHonorific(value, { tagSlugs = [], roleSlug = null, gender = "NEUTRAL" } = {}) {
  const v = (value ?? "").toString().trim();
  if (!v) return null;
  return earnedTitles({ tagSlugs, roleSlug, gender }).includes(v) ? v : null;
}

// Enforced server-side in both writers; fixed once first saved.
const AGE_MIN = 18;
const AGE_MAX = 90;

module.exports = {
  AGE_MIN,
  AGE_MAX,
  NAME_LIMITS,
  FULL_NAME_LIMIT,
  formatCharacterName,
  formatBareName,
  nameKey,
  matchesTypedName,
  splitLegacyName,
  normalizeHonorific,
  normalizeEarnedHonorific,
};
