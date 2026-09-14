// What a Squeeze cube leaves you able to say. {tag:stupid} is permanent and incurable, but the player
// keeps playing — the proxy keeps carrying their messages, it simply carries this instead. Length is
// preserved and content is not, so the shape of what they meant survives even though the meaning
// doesn't — legible as *communication failing*, not a bot swallowing the message. Deliberately NOT a
// cipher: there is nothing to decode here and never was. Pure and dependency-free.

const SYLLABLES = [
  "ehhhh", "blauh", "ghhr", "yahhh", "ugh", "eh", "uh", "gah", "mmnh",
  "hurhh", "nnn", "buh", "aaah", "ghuh", "wuh", "nyeh", "hhh", "orh",
];

const STUPID_SLUG = "stupid";

// Roughly one noise per word. Punctuation is redrawn, not copied — keeping the original would leak
// sentence structure. Also feeds the Rite of Reanimation's risen (THANATI.md §4), with growls instead.
const GHOUL_SYLLABLES = [
  "gggrah", "ghhh", "rrhhaa", "grrahh", "hhrrgh", "rhaa", "gruhh", "ghrahh",
];
const GHOUL_SLUG = "ghoul";

function babble(content, rng = Math.random, syllables = SYLLABLES) {
  const words = String(content ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const pick = () => syllables[Math.floor(rng() * syllables.length)];
  const out = [];
  let sinceBreak = 0;

  for (let i = 0; i < words.length; i += 1) {
    const first = out.length === 0;
    const syllable = pick();
    out.push(first ? syllable.charAt(0).toUpperCase() + syllable.slice(1) : syllable);
    sinceBreak += 1;
    if (i === words.length - 1) break;
    // A break every 2-4 noises, or a long message reads as one unreadable wall.
    if (sinceBreak >= 2 + Math.floor(rng() * 3)) {
      out.push(rng() < 0.5 ? "…" : ",");
      sinceBreak = 0;
    } else {
      out.push(",");
    }
  }

  const text = out
    .join(" ")
    .replace(/ ([,…])/g, "$1")
    .replace(/,$/, "");
  return `${text}${rng() < 0.5 ? "!" : "…"}`;
}

// Accepts CharacterTag[] (`{ tag: { slug } }`) or a bare Tag[], same as db/lib/examineVision.js#slugSet.
function speaksBabble(characterTags) {
  return (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === STUPID_SLUG);
}

// A Ghoul's line: growls, and LOUD — upper-cased the way Bascinet wrote them
// ("Gggrah! Ghhh! RRHHAA!").
function growl(content, rng = Math.random) {
  return babble(content, rng, GHOUL_SYLLABLES).toUpperCase();
}

module.exports = { babble, growl, speaksBabble, STUPID_SLUG, GHOUL_SLUG };
