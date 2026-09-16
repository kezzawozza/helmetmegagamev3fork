// The single source of the summed Gambit die modifier. Two contributors: Hunger at -1 * min(hungerStreak,
// cap), and the three extreme mood bands (docs/systemdocs/MOOD.md) — Ecstatic +1, Afraid -1, Panicking
// -2. A mood is one number so the three can never sum. Stays list-returning, not one number: Action.diceModifier
// is one Int but the confirm DM wants the contribution NAMED ("−2 Hungry"), and a new contributor is an append here.
// No prisma import, so both bot/ and web/ import it by subpath.
const { HUNGER_SLUG } = require("./constants");
const { HUNGER_STREAK_CAP } = require("./hungerPass");
const { bandOf } = require("./mood");

const HUNGER_LABEL = "Hungry";

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[].
function holds(characterTags, slug) {
  return (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === slug);
}

function hasHunger(characterTags = []) {
  return holds(characterTags, HUNGER_SLUG);
}

// -1 per consecutive hungry turn (Character.hungerStreak, hungerPass.js), floored at -HUNGER_STREAK_CAP
// (same cap that grants `dying`). No recorded streak still gets -1 as long as the tag is held.
function hungerModifier(hungerStreak = 0) {
  return -Math.min(Math.max(hungerStreak, 1), HUNGER_STREAK_CAP);
}

// [{ label, value }], omitting anything worth 0 — the confirm DM breakdown; gambitModifierTotal() is
// the number for the column. `hungerStreak`/`mood` live on Character, not a tag. EVERY caller must
// pass and select `mood` — a missed one reads undefined and silently lands in Fine.
function gambitModifiers(characterTags = [], { hungerStreak = 0, mood = 0 } = {}) {
  const out = [];

  if (hasHunger(characterTags)) out.push({ label: HUNGER_LABEL, value: hungerModifier(hungerStreak) });

  const band = bandOf(mood);
  if (band?.gambit) out.push({ label: band.label, value: band.gambit });

  return out;
}

function gambitModifierTotal(characterTags = [], opts = {}) {
  return gambitModifiers(characterTags, opts).reduce((sum, m) => sum + m.value, 0);
}

// "−1 Hungry" — U+2212 minus, matching the bot's roll line. Takes the
// array so a caller that already computed it doesn't recompute.
function formatGambitModifiers(modifiers = []) {
  return modifiers.map((m) => `${m.value > 0 ? "+" : "−"}${Math.abs(m.value)} ${m.label}`).join(" ");
}

// The die as the player reads it: the raw roll, the summed modifier, and the total.
// `bonus` is a per-caller extra on top of the stored diceModifier — the Minted Charm's
// +1 on a lesson is the one user. Lived in lessonPass.js until that pass was retired;
// researchPass.js and the lesson path both read it, so it belongs beside the modifier
// maths rather than inside whichever pass happened to define it first.
function rollLine(turn, action, bonus = 0) {
  const mod = (action.diceModifier ?? 0) + bonus;
  const total = (action.diceRoll ?? 0) + mod;
  const die = mod
    ? `**${action.diceRoll}** (${mod > 0 ? `+${mod}` : mod}) → **${total}**`
    : `**${action.diceRoll}**`;
  return { text: `🎲 Your Gambit for turn ${turn.number}: ${die}`, total };
}

module.exports = {
  gambitModifiers,
  gambitModifierTotal,
  formatGambitModifiers,
  rollLine,
};
