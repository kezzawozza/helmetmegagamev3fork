// What a Squeeze cube leaves you able to say.
//
// {tag:stupid} is permanent and incurable, and the point of it is that the
// player keeps playing — they can still walk into a room, still be led about,
// still be talked at — they just cannot make words any more. So the proxy
// keeps carrying their messages; it simply carries this instead.
//
// Length is preserved and content is not. Somebody typing a long anguished
// paragraph produces a long anguished noise, and a one-word answer produces a
// grunt, so the shape of what they meant survives even though the meaning
// doesn't. That is the whole design: it should be legible as *communication
// failing*, not as a bot swallowing the message.
//
// Deliberately NOT a cipher. There used to be one (db/lib/gribble.js, deleted
// with the paperwork rework) that turned a letter into runes an illiterate
// recipient could carry to a friend — the paper itself does that job now, and
// does it better, because it is an object. Babble is the opposite kind of
// thing: there is nothing to decode here and never was. What was said is gone.
//
// Pure and dependency-free, so both faces can use it and neither can drift.

const SYLLABLES = [
  "ehhhh", "blauh", "ghhr", "yahhh", "ugh", "eh", "uh", "gah", "mmnh",
  "hurhh", "nnn", "buh", "aaah", "ghuh", "wuh", "nyeh", "hhh", "orh",
];

const STUPID_SLUG = "stupid";

// Roughly one noise per word, so the reply is as long as the thought was.
// Punctuation is redrawn rather than copied: keeping the original commas would
// leak the sentence structure, which is most of what someone was saying.
// The Rite of Reanimation's risen (docs/systemdocs/THANATI.md §4): the same
// machine, fed growls. Bascinet's three, then variants in the same register.
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
    // A break every 2-4 noises. Without them a long message is one unreadable
    // wall, which reads as a bug rather than as somebody struggling.
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

// Accepts the CharacterTag[] shape used everywhere else (`{ tag: { slug } }`)
// and tolerates a bare Tag[], same as db/lib/examineVision.js#slugSet.
function speaksBabble(characterTags) {
  return (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === STUPID_SLUG);
}

// A Ghoul's line: growls, and LOUD — upper-cased the way Bascinet wrote them
// ("Gggrah! Ghhh! RRHHAA!").
function growl(content, rng = Math.random) {
  return babble(content, rng, GHOUL_SYLLABLES).toUpperCase();
}

module.exports = { babble, growl, speaksBabble, STUPID_SLUG, GHOUL_SLUG };
