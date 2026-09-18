// The single source of the summed Gambit die modifier. Three contributors: Hunger (a flat penalty off
// the hungry/starving tags, db/lib/hunger.js), the three extreme mood bands (docs/systemdocs/MOOD.md)
// — Ecstatic +1, Afraid -1, Panicking -2, and a mood is one number so those three can never sum — and
// any HELD tag carrying `Tag.gambitBonus`, which today means a Trinket forged with an Arkenstone
// (docs/systemdocs/TRINKETS.md). Stays list-returning, not one number: Action.diceModifier is one Int
// but the confirm DM wants the contribution NAMED ("−1 Hungry", "+1 Anduril"), and a new contributor
// is an append here.
//
// THE TRAP, and it is the same one the `mood` note below describes. This function reads whatever tag
// objects it is handed, so a caller whose Prisma select narrows the tag relation to `{ slug: true }`
// silently contributes nothing for `gambitBonus` — no error, just a die that is quietly one lower on
// that surface than on the sheet. Every select feeding this must pull `gambitBonus`; a bare
// `include: { tag: true }` gets it for free.
// No prisma import, so both bot/ and web/ import it by subpath.
const { HUNGER_SLUG, STARVING_SLUG } = require("./constants");
const { bandOf } = require("./mood");

// Starving wins outright and never sums with Hungry — both numbers are this
// plan's own inference (db/lib/hunger.js's Context §6), flagged for
// Bascinet to retune.
const HUNGER_PENALTY = Object.freeze({ starving: -3, hungry: -1 });
const HUNGER_LABELS = Object.freeze({ starving: "Starving", hungry: "Hungry" });

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[].
function holds(characterTags, slug) {
  return (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === slug);
}

// Starving checked first: a character at or below the Starving threshold
// holds BOTH tags at once (db/lib/hunger.js), and this is the one place that
// picks between them rather than summing.
function hungerBandOf(characterTags = []) {
  if (holds(characterTags, STARVING_SLUG)) return "starving";
  if (holds(characterTags, HUNGER_SLUG)) return "hungry";
  return null;
}

// [{ label, value }], omitting anything worth 0 — the confirm DM breakdown; gambitModifierTotal() is
// the number for the column. `mood` lives on Character, not a tag. EVERY caller must pass and select
// `mood` — a missed one reads undefined and silently lands in Fine.
function gambitModifiers(characterTags = [], { mood = 0 } = {}) {
  const out = [];

  const band = hungerBandOf(characterTags);
  if (band) out.push({ label: HUNGER_LABELS[band], value: HUNGER_PENALTY[band] });

  const moodBand = bandOf(mood);
  if (moodBand?.gambit) out.push({ label: moodBand.label, value: moodBand.gambit });

  // One entry per tag rather than one summed "Trinkets" line: the whole reason this returns a list is
  // so the player is told WHAT is helping them, and a Trinket's name is the only thing that
  // identifies it. Labelled by name, since every one of these is a custom mint with a name its maker
  // chose. Held, not equipped — the bonus is the holder's.
  for (const ct of characterTags ?? []) {
    const tag = ct?.tag ?? ct;
    const value = tag?.gambitBonus ?? 0;
    if (!value) continue;
    out.push({ label: tag.name ?? tag.slug ?? "Trinket", value });
  }

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
// +1 on a lesson is the one user. Lived in the lesson pass until lessons stopped resolving there;
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
