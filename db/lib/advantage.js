// Dice advantage: roll twice, keep the better die. One thing grants it:
// Lucky (TAGS.md §4a), a permanent mastery tag never removed by rolling.
// There was a second, one-shot source (Inspired, off Black River Mud), which
// is why the return shape still names `source` — it is "lucky" or null now.
// The push on's die also listens to a few traits, both ways (rollWithEdge
// below).
//
// This is a sibling of db/lib/gambitModifier.js rather than part of it, and the
// split is the point. A modifier is a number added to a die and named in the
// confirm DM ("−2 Hungry"); Action.diceModifier is one Int and stores the sum.
// Advantage is neither — it changes which die you rolled, not what you add to
// it, so folding it into the modifier list would have meant a modifier whose
// value depends on a roll that has not happened yet.
//
// Every d6 a CHARACTER rolls goes through here: the Gambit itself, the Caving
// Die, the mining drop die, and the Gambit-shaped rolls that Confession,
// Lessons and Torture make. A die nobody in particular rolls (a resource
// range, a loot draw) keeps using rollDie.
//
// No prisma import, so bot/ and web/ both require it by subpath.
const { LUCKY_SLUG } = require("./constants");
const { rollDie } = require("./rollDie");

// Accepts CharacterTag[] (`{ tag: { slug } }`) or a bare Tag[].
function holdsAdvantage(characterTags) {
  const held = characterTags ?? [];
  if (held.some((ct) => (ct?.tag?.slug ?? ct?.slug) === LUCKY_SLUG)) return LUCKY_SLUG;
  return null;
}

// -> { die, rolls, advantage, source }. `rolls` shows every die thrown so a surface can show the discarded one.
// `source` is `"lucky"` or null.
function rollWithAdvantage(characterTags, sides = 6) {
  const source = holdsAdvantage(characterTags);
  if (!source) {
    const die = rollDie(sides);
    return { die, rolls: [die], advantage: false, source: null };
  }
  const rolls = [rollDie(sides), rollDie(sides)];
  return { die: Math.max(...rolls), rolls, advantage: true, source };
}

// "(6, 2 — Lucky)" for a roll line. Null when there was no advantage, so a
// caller can concatenate it unconditionally.
function formatAdvantage({ rolls, advantage }) {
  if (!advantage || !rolls || rolls.length < 2) return null;
  return `(${rolls.join(", ")} — Lucky)`;
}

// The two-sided version, for a die that a few tags pull each way — the push
// on (db/lib/locationTravel.js, MAP.md §3) is the only one so far. `better`
// and `worse` are Sets of slugs; every held tag in `better` is one vote for
// keeping the higher of two dice, every one in `worse` a vote for the lower,
// and a tie (or nothing held) rolls once. Lucky is the caller's to put in
// `better`, so a die that ignores it can. Same return shape as
// rollWithAdvantage plus `edge` ("better" | "worse" | null) and the NAMES of
// the tags that decided it, in the order held, for the confirm's sentence.
//
// edgeFor is the decision on its own, with no die thrown, so a confirm can say
// "you have advantage on this roll" before the player commits.
function edgeFor(characterTags, { better, worse }) {
  const held = characterTags ?? [];
  const named = (set) =>
    held.filter((ct) => set.has(ct?.tag?.slug ?? ct?.slug)).map((ct) => ct?.tag?.name ?? ct?.name ?? ct?.tag?.slug ?? ct?.slug);
  const forIt = named(better);
  const against = named(worse);
  const lean = forIt.length - against.length;
  if (lean === 0) return { edge: null, names: [] };
  return { edge: lean > 0 ? "better" : "worse", names: lean > 0 ? forIt : against };
}

function rollWithEdge(characterTags, sets, sides = 6) {
  const { edge, names } = edgeFor(characterTags, sets);
  if (!edge) {
    const die = rollDie(sides);
    return { die, rolls: [die], advantage: false, edge, names };
  }
  const rolls = [rollDie(sides), rollDie(sides)];
  const die = edge === "better" ? Math.max(...rolls) : Math.min(...rolls);
  return { die, rolls, advantage: edge === "better", edge, names };
}

module.exports = { rollWithAdvantage, formatAdvantage, edgeFor, rollWithEdge };
