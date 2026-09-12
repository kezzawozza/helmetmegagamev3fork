// Dice advantage: roll twice, keep the better die. Lucky (TAGS.md 4a) is the
// only thing that grants it today.
//
// This is a sibling of db/lib/gambitModifier.js rather than part of it, and the
// split is the point. A modifier is a number added to a die and named in the
// confirm DM ("−2 Hungry"); Action.diceModifier is one Int and stores the sum.
// Advantage is neither — it changes which die you rolled, not what you add to
// it, so folding it into the modifier list would have meant a modifier whose
// value depends on a roll that has not happened yet.
//
// Every d6 a CHARACTER rolls goes through here: the Gambit itself, the Caving
// Die, the labor drop die, and the Gambit-shaped rolls that Confession,
// Lessons and Torture make. A die nobody in particular rolls (a resource
// range, a loot draw) keeps using rollDie.
//
// No prisma import, so bot/ and web/ both require it by subpath.
const { LUCKY_SLUG } = require("./constants");
const { rollDie } = require("./rollDie");

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[] — the same tolerance
// gambitModifier.js's own `holds` has, and for the same reason: half the
// callers have one shape and half the other.
function holdsAdvantage(characterTags) {
  return (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === LUCKY_SLUG);
}

// -> { die, rolls, advantage }. `rolls` is every die actually thrown, in the
// order thrown, so a surface can show the discarded one — a player who is
// paying 15 points for this should see it working, and a good roll that looks
// exactly like an ordinary good roll is a tag nobody can tell they own.
// `die` is always the one that counts, so a caller that does not care about
// the breakdown can read that field alone and behave as it did before.
function rollWithAdvantage(characterTags, sides = 6) {
  if (!holdsAdvantage(characterTags)) {
    const die = rollDie(sides);
    return { die, rolls: [die], advantage: false };
  }
  const rolls = [rollDie(sides), rollDie(sides)];
  return { die: Math.max(...rolls), rolls, advantage: true };
}

// "(6, 2 — Lucky)" for a roll line. Null when there was no advantage, so a
// caller can concatenate it unconditionally.
function formatAdvantage({ rolls, advantage }) {
  if (!advantage || !rolls || rolls.length < 2) return null;
  return `(${rolls.join(", ")} — Lucky)`;
}

module.exports = { rollWithAdvantage, formatAdvantage };
