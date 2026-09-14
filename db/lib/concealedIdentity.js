// The anonymous identity a character posts under with `/conceal` (bot/src/events/messageCreate.js).
// Pure — no prisma, no I/O. The alias deliberately carries only what a stranger could tell at a
// glance: roughly how old someone looks, and how they present.

// Under YOUNG you read as young, at OLD and above you read as old, and the broad middle gets no
// adjective at all — which is what makes the word mean something when it does appear.
const YOUNG_UNDER = 25;
const OLD_FROM = 55;

// Straight off Character.gender, so the alias can simply say it.
function genderWord(gender) {
  if (gender === "MAN") return "Man";
  if (gender === "WOMAN") return "Woman";
  return "Person";
}

function ageWord(age) {
  if (typeof age !== "number" || Number.isNaN(age)) return null;
  if (age < YOUNG_UNDER) return "Young";
  if (age >= OLD_FROM) return "Old";
  return null;
}

// "Young Man" / "Old Woman" / "Person". Used as the webhook username — Title Case, inside Discord's
// 80-char cap. Frozen into ArchiveEntry.concealedAlias at send time, so a later gender change never rewrites history.
function concealedAlias({ age, gender } = {}) {
  return [ageWord(age), genderWord(gender)].filter(Boolean).join(" ");
}

// The line shown when someone 🔍-inspects a concealed message. Lower-cased
// mid-sentence: "An unknown young woman, their identity concealed."
function concealedLine(alias) {
  return `An unknown ${(alias || "person").toLowerCase()}, their identity concealed.`;
}

// "a young man" / "an old woman" — a noun phrase for a line of prose. Shared by the whisper poll and
// the room stash announcements so the same person reads the same way in both.
function withArticle(word) {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

function capitalizeFirst(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "a young woman" — a row in a list of who is standing here. Prefers what a viewer LAST HEARD this
// person called (db/lib/sightings.js) over their current alias. Shared by whosHere's concealed column
// and presentedMembers' strip, which sit inches apart on /chat.
function aliasRow(character, sightingName = null) {
  return withArticle((sightingName ?? concealedAlias(character ?? {})).toLowerCase());
}

// "An old woman", ready to start a sentence.
function aliasSubject(character) {
  return capitalizeFirst(withArticle(concealedAlias(character ?? {}).toLowerCase()));
}

// Every alias a hood can produce: three age words against three gender words, nine strings, built
// from the same functions the alias itself is. Exists to read an ARCHIVED row back — a
// ArchiveEntry.concealedAlias not in this closed set was a forced name instead. See presentedIdentity.js#wasHooded.
const CONCEALED_ALIASES = new Set(
  [null, 24, 60].flatMap((age) => ["MAN", "WOMAN", "NEUTRAL"].map((gender) => concealedAlias({ age, gender }))),
);

function isConcealedAlias(alias) {
  return CONCEALED_ALIASES.has(alias);
}

module.exports = {
  concealedAlias,
  concealedLine,
  genderWord,
  withArticle,
  capitalizeFirst,
  aliasRow,
  aliasSubject,
  isConcealedAlias,
};
