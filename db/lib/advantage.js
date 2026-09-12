// Dice advantage: roll twice, keep the better die. Two things grant it:
// Lucky (TAGS.md §4a), a permanent mastery tag never removed by rolling, and
// Inspired (Black River Mud), a one-shot consumable buff that has to
// disappear the moment it wins a Gambit rather than by its timer alone —
// which is why rollWithAdvantage reports WHICH one fired, so a Gambit call
// site knows whether it owes a consume afterward (db/lib/tagWrites.js's
// consumeInspiredIfUsed). Lucky is never consumed; Inspired always is, when
// it's the one that granted the roll.
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
const { LUCKY_SLUG, INSPIRED_SLUG } = require("./constants");
const { rollDie } = require("./rollDie");

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[] — the same tolerance
// gambitModifier.js's own `holds` has, and for the same reason: half the
// callers have one shape and half the other.
//
// `gambitOnly` opts a caller into ALSO checking Inspired — the Caving Die
// and the labor drop die call rollWithAdvantage too (for Lucky), but
// Inspired grants advantage on "your next Gambit" specifically, not the
// next d6 of any kind, so only a true Gambit-shaped roll passes this.
function holdsAdvantage(characterTags, { gambitOnly = false } = {}) {
  const held = characterTags ?? [];
  if (held.some((ct) => (ct?.tag?.slug ?? ct?.slug) === LUCKY_SLUG)) return LUCKY_SLUG;
  if (gambitOnly && held.some((ct) => (ct?.tag?.slug ?? ct?.slug) === INSPIRED_SLUG)) return INSPIRED_SLUG;
  return null;
}

// -> { die, rolls, advantage, source }. `rolls` is every die actually
// thrown, in the order thrown, so a surface can show the discarded one — a
// player who is paying 15 points (or smoking a rare powder) for this should
// see it working, and a good roll that looks exactly like an ordinary good
// roll is a tag nobody can tell they own. `die` is always the one that
// counts, so a caller that does not care about the breakdown can read that
// field alone and behave as it did before. `source` is `"lucky"` /
// `"inspired"` / `null` — a true-Gambit caller passing `gambitOnly: true`
// uses it to know whether it owes db/lib/tagWrites.js#consumeInspiredIfUsed
// afterward; Lucky is never consumed.
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
