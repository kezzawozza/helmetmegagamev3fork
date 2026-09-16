// The Steal verb's die (docs/systemdocs/THEFT.md §1). Taking something out of a
// room stash you can reach, quietly.
//
// The goods ALWAYS move. The roll decides one thing only: whether the room
// thread is told. That is the whole verb — a failed steal is not a stopped
// steal, it is a noticed one, and Transfer is still sitting there for anyone
// who does not mind being seen.
//
// Pure: no prisma, no I/O, so db/test/steal.test.js can cover all of it and
// neither face drags the barrel into a bundle.
//
// The [{ label, value }] return shape is deliberately db/lib/gambitModifier.js's,
// so formatGambitModifiers() renders the breakdown for the audit row with no
// second formatter, and a new contributor is one append to the table below.

// 4, 5 or 6 on a d6 goes unnoticed. An average person is seen a third of the time.
const STEAL_TARGET = 4;

// How steady your hands are. The list is CLOSED and deliberately narrower than
// gambitModifiers(): Hunger and the mood bands do NOT apply here. Steal costs
// no Move and has no ration, so folding those in would make a hungry
// character's every theft loud with nothing they could do about it.
//
// Subtle is NOT in this table, and its absence is the interesting one. It used
// to read "the room never notices you doing it", which is exactly this verb; it
// was rewritten on 2026-09-16 to be about whispers not carrying, so it is a
// sound tag now rather than a sleight-of-hand one.
const HANDS = [
  ["stealth", "Stealth", 2],
  ["clumsy", "Clumsy", -2],
];

// How drunk you are, worst rung first. THE WORST ONE COUNTS AND THEY NEVER SUM,
// the same shape gambitModifier.js gives a mood ("a mood is one number so the
// three can never sum").
//
// It matters, because the chain is not as tidy as it looks. Tipsy escalates
// into Wasted, so those two are never held together — but Blind Drunk is a
// separate tag off a bad drink, and NOTHING stops it landing on somebody
// already Wasted. Summed, that pair is a silent −4 and a 6 that still fails,
// which is a worse punishment than either tag claims to be.
const DRINK = [
  ["blind-drunk", "Blind Drunk", -2],
  ["wasted", "Wasted", -2],
  ["tipsy", "Tipsy", -1],
];

// Every slug that moves this die, for anything that wants to ask.
const STEAL_MODIFIERS = [...HANDS, ...DRINK];

// Accepts the CharacterTag[] shape used everywhere else (`{ tag: { slug } }`),
// and tolerates a bare Tag[] — the same tolerance advantage.js and
// gambitModifier.js have, for the same reason: callers select both shapes.
function slugsOf(characterTags = []) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

// -> [{ label, value }], in table order, omitting anything not held. Table
// order rather than held order so two characters with the same tags always
// read the same way in an audit row.
//
// Stealth and Clumsy cannot both land (docs/tags.yaml pins them `conflictsWith`
// each other), so nothing needs to arbitrate between those two. The drink rungs
// can, so only the worst one is taken.
function stealModifiers(characterTags = []) {
  const held = slugsOf(characterTags);
  const hands = HANDS.filter(([slug]) => held.has(slug)).map(([, label, value]) => ({ label, value }));
  const drink = DRINK.find(([slug]) => held.has(slug));
  return drink ? [...hands, { label: drink[1], value: drink[2] }] : hands;
}

function stealModifierTotal(characterTags = []) {
  return stealModifiers(characterTags).reduce((sum, m) => sum + m.value, 0);
}

// The die as the rules read it. `modifiers` is the list, not the sum, so a
// caller that already built it for the audit row does not rebuild it.
function stealTotal(die, modifiers = []) {
  return (Number(die) || 0) + modifiers.reduce((sum, m) => sum + m.value, 0);
}

// Did the room fail to notice? Clumsy (-2) needs a 6; Stealth (+2) fails only
// on a 1. Nothing floors or caps this on purpose — Clumsy and Stealth cannot
// be held together (docs/tags.yaml, `conflictsWith`), and the drink ladder
// stacking with Clumsy to unreachable is the point of being that drunk.
function stealSucceeds(die, modifiers = []) {
  return stealTotal(die, modifiers) >= STEAL_TARGET;
}

module.exports = {
  STEAL_TARGET,
  STEAL_MODIFIERS,
  HANDS,
  DRINK,
  stealModifiers,
  stealModifierTotal,
  stealTotal,
  stealSucceeds,
};
