// A bare name is a mention (REDESIGN.md §2, §6). Saying "Marrow, get down"
// names Marrow exactly as `@Marrow` would: a real ping relayed on Discord, a
// notified count on the web. This module answers one question — DOES THIS TEXT
// NAME THIS CHARACTER — and nothing else. Who was in earshot, who is hooded and
// what to do about it stay with the callers, which is what lets the bot, the
// web's send path and a browser all ask the same question and get the same
// answer.
//
// ZERO REQUIRES, EVER. The web draws its own notified count by asking this
// directly from a "use client" component, the way db/lib/chunkText.js is asked
// there — one require of @lifeweb/db here would drag PrismaClient into the
// browser bundle. Same rule db/lib/dmPolicy.js carries.
//
// The explicit `{char:<id>}` token is a separate mechanism and stays that way
// (db/lib/characterMentions.js). A row's text is face-neutral, so a token is
// still what a picked-from-the-@-menu mention is made of; this is what catches
// the nine lines out of ten where somebody just typed a name.

// A bare FIRST name has to be at least this long to count on its own. The full
// presented name always counts, however short. Without a floor a character
// called "Al" would be named by "al dente", and a one-letter name by every "I"
// in the room.
const MIN_BARE_NAME = 3;

// What the token grammar writes into a row — an explicit `{char:…}` mention, a
// `{resource:…}` bubble, a `{tag:…}` chip. Cut before scanning, so the NAME
// inside an explicit mention is not also counted as a bare one (that would be
// the same mention twice) and so a name inside any other bubble is left alone.
const TOKEN_RE = /\{[a-z]+:[^{}\n]*\}/g;

// A URL. A name inside a link is part of an address, not something said.
const URL_RE = /https?:\/\/\S+/g;

// The two spellings that count (REDESIGN.md §6): the presented name WHOLE, and
// its bare FIRST word — which for `Character.firstName` + `lastName` is the first
// name, the thing anybody in a room actually says.
//
// Two words and no more, deliberately. Offering every word of a name would ping
// Ilda Roke at every "Roke" AND every "Sister" in a name like "Sister Ilda Roke",
// and a mention that fires on a common word is a mention nobody trusts. Longest
// first, so a match is attributed to the fullest spelling present.
function nameForms(name) {
  if (typeof name !== "string") return [];
  const whole = name.replace(/\s+/g, " ").trim();
  if (!whole) return [];
  const forms = [whole];
  const first = whole.split(" ")[0];
  if (first !== whole && first.length >= MIN_BARE_NAME) forms.push(first);
  return forms.sort((a, b) => b.length - a.length);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word, case-insensitive, Unicode-aware. `\b` is ASCII-only in JavaScript,
// so a name ending in an accented letter would match inside a longer word; the
// lookarounds ask for "not a letter, digit or underscore" in every script. A
// trailing possessive is a naming — "Marrow's hammer" names Marrow — so an
// apostrophe is deliberately a boundary.
function namesIn(text, form) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(form)}(?![\\p{L}\\p{N}_])`, "iu");
  return re.test(text);
}

// Strip what must not be scanned. Cheap, and it runs on every line said in the
// game, so it is two replaces and no parsing.
function scannable(text) {
  if (typeof text !== "string" || !text) return "";
  return text.replace(TOKEN_RE, " ").replace(URL_RE, " ");
}

// Does this text name this character? `name` is the PRESENTED name — what the
// room would have heard — because that is the only name a speaker could have
// used. A caller holding a hooded character must not ask about their real one.
function textNamesCharacter(text, name) {
  const body = scannable(text);
  if (!body) return false;
  for (const form of nameForms(name)) {
    if (namesIn(body, form)) return true;
  }
  return false;
}

// Which of these candidates the text names. `candidates` are already narrowed by
// the caller to whoever could have heard it — earshot is a database question and
// this module asks none. Each is `{ id, name, concealed }`.
//
// Two rules live here rather than at three call sites, because forgetting either
// one is a bug that only shows up in play:
//
//   A CONCEALED character is never named. The whole point of a hood is that the
//   room does not know who is under it (PROXYING.md §5), so a hooded character's
//   real name said aloud must not ping them — it would confirm the hood.
//
//   THE SPEAKER is never named. Saying your own name is not a mention of you,
//   and a notification for your own line is the one thing nobody wants. Matched
//   on id and on hood token, since a hooded row carries the token and no id.
function charactersNamedIn(text, candidates, { speakerId = null, speakerKey = null } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const body = scannable(text);
  if (!body) return [];
  const out = [];
  for (const candidate of candidates) {
    if (!candidate?.name) continue;
    if (candidate.concealed) continue;
    if (speakerId && candidate.id === speakerId) continue;
    if (speakerKey && candidate.speakerKey && candidate.speakerKey === speakerKey) continue;
    for (const form of nameForms(candidate.name)) {
      if (!namesIn(body, form)) continue;
      out.push(candidate);
      break;
    }
  }
  return out;
}

module.exports = {
  MIN_BARE_NAME,
  nameForms,
  textNamesCharacter,
  charactersNamedIn,
};
