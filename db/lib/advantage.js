// Dice advantage: roll twice, keep the better die. Lucky (TAGS.md §4a) is a permanent mastery tag;
// Inspired (Black River Mud) is one-shot and must be consumed via db/lib/tagWrites.js#consumeInspiredIfUsed
// when it's the one that fired, which is why rollWithAdvantage reports WHICH source granted the roll.
// Sibling of db/lib/gambitModifier.js, not part of it: advantage changes which die is rolled, not what's added.
// Every d6 a CHARACTER rolls goes through here (Gambit, Caving Die, labor drop, Confession/Lessons/Torture rolls).
// No prisma import, so bot/ and web/ both require it by subpath.
const { LUCKY_SLUG, INSPIRED_SLUG } = require("./constants");
const { rollDie } = require("./rollDie");

// Accepts CharacterTag[] (`{ tag: { slug } }`) or a bare Tag[].
// `gambitOnly` also checks Inspired, which grants advantage on the next Gambit specifically, not any d6.
function holdsAdvantage(characterTags, { gambitOnly = false } = {}) {
  const held = characterTags ?? [];
  if (held.some((ct) => (ct?.tag?.slug ?? ct?.slug) === LUCKY_SLUG)) return LUCKY_SLUG;
  if (gambitOnly && held.some((ct) => (ct?.tag?.slug ?? ct?.slug) === INSPIRED_SLUG)) return INSPIRED_SLUG;
  return null;
}

// -> { die, rolls, advantage, source }. `rolls` shows every die thrown so a surface can show the discarded one.
// `source` (`"lucky"`/`"inspired"`/null) tells a Gambit caller whether it owes db/lib/tagWrites.js#consumeInspiredIfUsed.
function rollWithAdvantage(characterTags, sides = 6, { gambitOnly = false } = {}) {
  const source = holdsAdvantage(characterTags, { gambitOnly });
  if (!source) {
    const die = rollDie(sides);
    return { die, rolls: [die], advantage: false, source: null };
  }
  const rolls = [rollDie(sides), rollDie(sides)];
  return { die: Math.max(...rolls), rolls, advantage: true, source };
}

// "(6, 2 — Lucky)" / "(6, 2 — Inspired)" for a roll line. Null when there was
// no advantage, so a caller can concatenate it unconditionally.
function formatAdvantage({ rolls, advantage, source }) {
  if (!advantage || !rolls || rolls.length < 2) return null;
  const label = source === "inspired" ? "Inspired" : "Lucky";
  return `(${rolls.join(", ")} — ${label})`;
}

module.exports = { rollWithAdvantage, formatAdvantage };
