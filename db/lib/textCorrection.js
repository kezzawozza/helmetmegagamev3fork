// Sentence-start capitalization and closed-list contraction apostrophes, applied to Tupper-proxied messages when GameConfig.tupperAutocorrectEnabled is on (db/lib/say.js, the one write path). Skips code blocks/inline code and URLs so it never mangles either.

const SKIP_SEGMENT = /```[\s\S]*?```|`[^`]*`|https?:\/\/\S+/g;

function applyOutsideSkipped(content, fn) {
  if (!content) return content;

  let result = "";
  let lastIndex = 0;
  for (const match of content.matchAll(SKIP_SEGMENT)) {
    result += fn(content.slice(lastIndex, match.index));
    result += match[0];
    lastIndex = match.index + match[0].length;
  }
  result += fn(content.slice(lastIndex));

  return result;
}

function capitalizeSegment(segment) {
  // Capitalizes the first letter, and after ./!/? plus whitespace — deliberately conservative, no attempt at "e.g." or decimals. An ellipsis is left alone too: "That's... odd." trails on rather than starting a new sentence, so the lookbehind skips a terminator preceded by a dot.
  return segment.replace(/(^\s*|(?<!\.)[.!?]\s+)([a-z])/g, (match, lead, letter) => lead + letter.toUpperCase());
}

function capitalizeSentences(content) {
  return applyOutsideSkipped(content, capitalizeSegment);
}

// Closed list of missing-apostrophe contractions. Deliberately excludes any form that is itself a real English word (e.g. "were", "well", "its", "wont") since a false positive would silently change what a player wrote.
const CONTRACTIONS = [
  "dont", "doesnt", "didnt", "isnt", "arent", "wasnt", "werent", "hasnt", "havent", "hadnt",
  "wouldnt", "couldnt", "shouldnt", "mustnt", "aint", "cant",
  "youre", "theyre",
  "youve", "theyve", "weve",
  "wouldve", "couldve", "shouldve", "mustve",
  "thats", "whats", "theres", "heres", "wheres", "whos",
  "youll", "theyll", "itll", "thatll",
  "youd", "theyd",
];

const CONTRACTION_RE = new RegExp(`\\b(${CONTRACTIONS.join("|")})\\b`, "gi");

// Re-inserts the apostrophe (n't, 're, 've, 's, 'll, 'd), and preserves the writer's casing — all-lowercase, leading-capital, or ALL-CAPS. Anything mixed beyond that is left as typed.
function restoreApostrophe(word) {
  const lower = word.toLowerCase();
  let splitAt;
  if (lower.endsWith("nt")) splitAt = lower.length - 1;
  else if (lower.endsWith("re") || lower.endsWith("ve") || lower.endsWith("ll")) splitAt = lower.length - 2;
  else if (lower.endsWith("s") || lower.endsWith("d")) splitAt = lower.length - 1;
  else splitAt = lower.length;

  const fixed = `${word.slice(0, splitAt)}'${word.slice(splitAt)}`;

  if (word === lower) return fixed.toLowerCase();
  if (word === word.toUpperCase()) return fixed.toUpperCase();
  if (word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()) {
    return fixed[0].toUpperCase() + fixed.slice(1).toLowerCase();
  }
  return word; // mixed casing we don't recognize — leave untouched
}

function fixContractionsSegment(segment) {
  return segment.replace(CONTRACTION_RE, (match) => restoreApostrophe(match));
}

function fixContractions(content) {
  return applyOutsideSkipped(content, fixContractionsSegment);
}

module.exports = { capitalizeSentences, fixContractions };
